package sentryreporting

import (
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
)

// Config controls backend error reporting.
type Config struct {
	DSN         string
	Environment string
	Release     string
	Transport   sentry.Transport
}

// Context adds application metadata to an error event.
type Context struct {
	Source    string
	ClusterID string
}

// Reporter sends backend failures to an error-reporting service.
type Reporter interface {
	Enabled() bool
	SetEnabled(enabled bool) error
	CaptureException(err error, context Context)
	CaptureMessage(message string, context Context)
	CapturePanic(recovered any, context Context)
	Shutdown(timeout time.Duration) bool
}

type disabledReporter struct{}

// ConfigFromEnvironment lets SENTRY_BACKEND_DSN override the DSN embedded by
// the application build. Release identity and environment remain build-owned.
func ConfigFromEnvironment(defaultDSN, defaultRelease, defaultEnvironment string) Config {
	return Config{
		DSN:         environmentValue("SENTRY_BACKEND_DSN", defaultDSN),
		Release:     strings.TrimSpace(defaultRelease),
		Environment: strings.TrimSpace(defaultEnvironment),
	}
}

func environmentValue(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return strings.TrimSpace(fallback)
}

// New creates a reporter. An empty DSN keeps reporting disabled.
func New(config Config) (Reporter, error) {
	if strings.TrimSpace(config.DSN) == "" {
		return disabledReporter{}, nil
	}
	reporter := &sentryReporter{config: config}
	if err := reporter.SetEnabled(true); err != nil {
		return nil, err
	}
	return reporter, nil
}

// NewDisabled creates a configured reporter that cannot capture events until
// SetEnabled(true) is called after the persisted preference has been loaded.
func NewDisabled(config Config) (Reporter, error) {
	if strings.TrimSpace(config.DSN) == "" {
		return disabledReporter{}, nil
	}
	return &sentryReporter{config: config}, nil
}

func newSentryHub(config Config) (*sentry.Hub, error) {
	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:                    config.DSN,
		Environment:            config.Environment,
		Release:                config.Release,
		AttachStacktrace:       true,
		EnableTracing:          false,
		DataCollection:         disabledDataCollection(),
		BeforeSend:             sanitizeEvent,
		MaxBreadcrumbs:         -1,
		Tags:                   map[string]string{"app.surface": "backend"},
		DisableLogs:            true,
		DisableMetrics:         true,
		DisableClientReports:   true,
		Transport:              config.Transport,
		DisableTelemetryBuffer: true,
	})
	if err != nil {
		return nil, err
	}

	return sentry.NewHub(client, sentry.NewScope()), nil
}

const anonymousBackendErrorMessage = "Backend error"

func isSafeBackendSource(value string) bool {
	switch value {
	case "App", "Auth", "ContainerLogs", "ContainerLogsStream", "ErrorCapture",
		"EventStream", "Frontend", "Heartbeat", "Helm", "KubernetesClient",
		"KubeconfigManager", "KubeconfigWatcher", "ObjectCatalog", "PortForward",
		"Process", "Refresh", "ResourceLoader", "ResourceStream", "Settings",
		"ShellSession", "StdLog", "StreamMux", "UpdateCheck", "Wails":
		return true
	default:
		return false
	}
}

func anonymousBackendExceptionType(value string) string {
	value = strings.TrimPrefix(strings.TrimSpace(value), "*")
	if separator := strings.LastIndexByte(value, '.'); separator >= 0 {
		value = value[separator+1:]
	}
	if value == "" || len(value) > 64 {
		return "Error"
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '_' {
			continue
		}
		if index > 0 && character >= '0' && character <= '9' {
			continue
		}
		return "Error"
	}
	return value
}

func sanitizeMechanism(mechanism *sentry.Mechanism) *sentry.Mechanism {
	if mechanism == nil {
		return nil
	}
	mechanismType := sentry.MechanismTypeGeneric
	if mechanism.Type == sentry.MechanismTypeChained {
		mechanismType = sentry.MechanismTypeChained
	}
	var handled *bool
	if mechanism.Handled != nil {
		value := *mechanism.Handled
		handled = &value
	}
	var parentID *int
	if mechanism.ParentID != nil {
		value := *mechanism.ParentID
		parentID = &value
	}
	return &sentry.Mechanism{
		Type:             mechanismType,
		Handled:          handled,
		ParentID:         parentID,
		ExceptionID:      mechanism.ExceptionID,
		IsExceptionGroup: mechanism.IsExceptionGroup,
	}
}

// sanitizeEvent reduces an event to diagnostic fields that originate in the
// application build or stack layout. Runtime values such as error text,
// cluster identity, request data, device context, and local paths are removed.
func sanitizeEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}

	tags := map[string]string{"app.surface": "backend"}
	if source := event.Tags["source"]; isSafeBackendSource(source) {
		tags["source"] = source
	}
	exceptions := make([]sentry.Exception, len(event.Exception))
	for index, exception := range event.Exception {
		exceptions[index] = sentry.Exception{
			Type:       anonymousBackendExceptionType(exception.Type),
			Value:      anonymousBackendErrorMessage,
			Stacktrace: sanitizedStacktrace(exception.Stacktrace),
			Mechanism:  sanitizeMechanism(exception.Mechanism),
		}
	}

	return &sentry.Event{
		Environment: event.Environment,
		EventID:     event.EventID,
		Level:       event.Level,
		Message:     anonymousBackendErrorMessage,
		Platform:    event.Platform,
		Release:     event.Release,
		Tags:        tags,
		Timestamp:   event.Timestamp,
		Exception:   exceptions,
		Threads:     sanitizedThreads(event.Threads),
	}
}

func sanitizedThreads(threads []sentry.Thread) []sentry.Thread {
	sanitized := make([]sentry.Thread, 0, len(threads))
	for _, thread := range threads {
		stacktrace := sanitizedStacktrace(thread.Stacktrace)
		if stacktrace == nil || len(stacktrace.Frames) == 0 {
			continue
		}
		sanitized = append(sanitized, sentry.Thread{
			Stacktrace: stacktrace,
			Crashed:    thread.Crashed,
			Current:    thread.Current,
		})
	}
	return sanitized
}

func sanitizedStacktrace(stacktrace *sentry.Stacktrace) *sentry.Stacktrace {
	if stacktrace == nil {
		return nil
	}
	frames := make([]sentry.Frame, len(stacktrace.Frames))
	for index, frame := range stacktrace.Frames {
		filename := path.Base(strings.ReplaceAll(frame.Filename, "\\", "/"))
		frames[index] = sentry.Frame{
			Function: frame.Function,
			Module:   frame.Module,
			Filename: filename,
			Lineno:   frame.Lineno,
			Colno:    frame.Colno,
			InApp:    frame.InApp,
		}
	}
	return &sentry.Stacktrace{Frames: frames}
}

func disabledDataCollection() *sentry.DataCollection {
	off := func() *sentry.KeyValueCollectionBehavior {
		return &sentry.KeyValueCollectionBehavior{Mode: sentry.CollectionOff}
	}
	return &sentry.DataCollection{
		UserInfo:    sentry.Set(false),
		Cookies:     off(),
		HTTPHeaders: &sentry.HeaderCollectionConfig{Request: off(), Response: off()},
		HTTPBodies:  []sentry.BodyType{},
		QueryParams: off(),
	}
}

func (disabledReporter) Enabled() bool {
	return false
}

func (disabledReporter) SetEnabled(bool) error           { return nil }
func (disabledReporter) CaptureException(error, Context) {}
func (disabledReporter) CaptureMessage(string, Context)  {}
func (disabledReporter) CapturePanic(any, Context)       {}
func (disabledReporter) Shutdown(time.Duration) bool     { return true }

type sentryReporter struct {
	mu     sync.RWMutex
	config Config
	hub    *sentry.Hub
}

func (r *sentryReporter) Enabled() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.hub != nil
}

func (r *sentryReporter) SetEnabled(enabled bool) error {
	r.mu.Lock()
	if enabled {
		if r.hub != nil {
			r.mu.Unlock()
			return nil
		}
		hub, err := newSentryHub(r.config)
		if err != nil {
			r.mu.Unlock()
			return err
		}
		r.hub = hub
		r.mu.Unlock()
		return nil
	}

	hub := r.hub
	r.hub = nil
	r.mu.Unlock()
	if hub != nil {
		// Opting out closes the transport without flushing buffered events.
		hub.Client().Close()
	}
	return nil
}

func (r *sentryReporter) CaptureMessage(message string, context Context) {
	r.withHub(context, func(hub *sentry.Hub) {
		hub.CaptureMessage(message)
	})
}

func (r *sentryReporter) CaptureException(err error, context Context) {
	r.withHub(context, func(hub *sentry.Hub) {
		hub.CaptureException(err)
	})
}

func (r *sentryReporter) CapturePanic(recovered any, context Context) {
	r.withHub(context, func(hub *sentry.Hub) {
		hub.Recover(recovered)
	})
}

func (r *sentryReporter) Shutdown(timeout time.Duration) bool {
	r.mu.Lock()
	hub := r.hub
	r.hub = nil
	r.mu.Unlock()
	if hub == nil {
		return true
	}
	flushed := hub.Flush(timeout)
	hub.Client().Close()
	return flushed
}

func (r *sentryReporter) withHub(context Context, capture func(*sentry.Hub)) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.hub == nil {
		return
	}
	hub := r.hub.Clone()
	hub.ConfigureScope(func(scope *sentry.Scope) {
		if context.Source != "" {
			scope.SetTag("source", context.Source)
		}
		if context.ClusterID != "" {
			scope.SetTag("clusterId", context.ClusterID)
		}
	})
	capture(hub)
}
