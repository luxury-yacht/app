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

// sanitizeEvent reduces an event to diagnostic fields that originate in the
// application build or stack layout. Runtime values such as error text,
// cluster identity, request data, device context, and local paths are removed.
func sanitizeEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}

	event.Message = anonymousBackendErrorMessage
	event.Breadcrumbs = nil
	event.Contexts = nil
	event.Dist = ""
	event.Fingerprint = nil
	event.ServerName = ""
	event.Tags = map[string]string{"app.surface": "backend"}
	event.Transaction = ""
	event.User = sentry.User{}
	event.Logger = ""
	event.Modules = nil
	event.Request = nil
	event.DebugMeta = nil
	event.Attachments = nil
	event.Type = ""
	event.StartTime = time.Time{}
	event.Spans = nil
	event.TransactionInfo = nil
	event.CheckIn = nil
	event.MonitorConfig = nil
	event.Threads = nil
	event.Logs = nil
	event.Metrics = nil

	for index := range event.Exception {
		exception := &event.Exception[index]
		exception.Type = "Error"
		exception.Value = anonymousBackendErrorMessage
		exception.Module = ""
		exception.ThreadID = 0
		exception.Mechanism = nil
		sanitizeStacktrace(exception.Stacktrace)
	}

	return event
}

func sanitizeStacktrace(stacktrace *sentry.Stacktrace) {
	if stacktrace == nil {
		return
	}
	for index, frame := range stacktrace.Frames {
		filename := path.Base(strings.ReplaceAll(frame.Filename, "\\", "/"))
		stacktrace.Frames[index] = sentry.Frame{
			Function: frame.Function,
			Module:   frame.Module,
			Filename: filename,
			Lineno:   frame.Lineno,
			Colno:    frame.Colno,
			InApp:    frame.InApp,
		}
	}
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
