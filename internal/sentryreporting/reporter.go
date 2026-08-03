package sentryreporting

import (
	"os"
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
	CaptureLogError(message string, context Context)
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
		Dsn:         config.DSN,
		Environment: config.Environment,
		Release:     config.Release,
		// An empty DataCollection opts into the SDK's own defaults rather than
		// disabling collection; see resolveDataCollection in sentry-go.
		DataCollection: &sentry.DataCollection{},
		BeforeSend:     trimReportingFrames,
		// The buffered telemetry path makes Client.Close flush before it stops,
		// which would transmit queued events on opt-out and block the caller
		// for up to the scheduler timeout. Opting out must simply stop sending.
		DisableTelemetryBuffer: true,
		Transport:              config.Transport,
	})
	if err != nil {
		return nil, err
	}

	return sentry.NewHub(client, sentry.NewScope()), nil
}

// LoggedError keeps application log failures exception-shaped so Sentry
// displays the original message and captures the call stack.
//
// The name is user-visible: Sentry titles an issue "<type>: <value>", so these
// read as "sentryreporting.LoggedError: <message>", which also distinguishes
// them from captured Go errors and recovered panics.
type LoggedError string

func (e LoggedError) Error() string {
	return string(e)
}

const (
	reporterModule   = "github.com/luxury-yacht/app/internal/sentryreporting"
	reporterFuncName = "(*sentryReporter)."
	appLogModule     = "github.com/luxury-yacht/app/backend/internal/applog"
	appModule        = "github.com/luxury-yacht/app/backend"
	appLoggerFunc    = "(*Logger)."
	// appModulePrefix identifies this module's own packages. sentry-go reports
	// Frame.Module as the package import path; package main is the exception and
	// arrives as the bare string "main".
	appModulePrefix = "github.com/luxury-yacht/app"
	mainModule      = "main"
)

// isApplicationFrame reports whether a frame is this module's own code.
//
// sentry-go marks everything outside GOROOT as in-app, which includes Wails,
// client-go, and every other dependency under the module cache. Sentry groups
// only on frames the SDK associates with the application, so leaving that
// default in place ties the grouping key to dependency internals: upgrading a
// dependency would re-group unrelated issues.
func isApplicationFrame(frame sentry.Frame) bool {
	return frame.Module == mainModule || strings.HasPrefix(frame.Module, appModulePrefix)
}

// logForwarders are functions whose only job is handing a message to the
// application logger. They sit between the failing code and the reporter, so
// leaving them in makes Sentry name the forwarder as an issue's culprit.
//
// A forwarder cannot be recognised structurally — a stack cannot say whether a
// function did work before logging. So this is a maintained list, and its known
// failure mode is that a NEW forwarder silently becomes the culprit for every
// issue its callers report. `LogRequestFailure` was added after exactly that
// happened live. Register new forwarders here; the guard test pins the shapes.
var logForwarders = map[string]struct{}{
	// The per-package "log an error for this package" convention. Only the
	// error-level name is listed: the application logger forwards ERROR entries
	// alone, so a warn-level wrapper can never appear in a captured stack.
	"logError": {},
	// resources/common, fronting every resource read.
	"LogRequestFailure": {},
}

// isLogWrapperFrame reports whether a frame is a registered log forwarder.
// sentry-go renders these receiver-qualified, e.g. "(*Service).logError" or
// "Dependencies.LogRequestFailure", so the receiver is stripped before the
// method name is compared.
func isLogWrapperFrame(frame sentry.Frame) bool {
	name := frame.Function
	if separator := strings.LastIndexByte(name, '.'); separator >= 0 {
		name = name[separator+1:]
	}
	_, forwarder := logForwarders[name]
	return forwarder
}

// isReportingFrame reports whether a frame belongs to the machinery that
// carries a failure to Sentry rather than to the code that failed. The
// application logger forwards every ERROR entry through this reporter, so
// these frames sit innermost on every log-forwarded event.
//
// Both package matches are narrowed to the forwarding methods themselves, so a
// failure originating inside either package still reports its own call site.
func isReportingFrame(frame sentry.Frame) bool {
	// Applies in any package: services wrap the logger before calling it.
	if isLogWrapperFrame(frame) {
		return true
	}
	switch frame.Module {
	case reporterModule:
		return strings.HasPrefix(frame.Function, reporterFuncName)
	case appLogModule:
		return true
	case appModule:
		// Only the logger's own methods; the rest of the package is app code.
		return strings.HasPrefix(frame.Function, appLoggerFunc)
	default:
		return false
	}
}

// trimReportingFrames drops the reporting machinery from the innermost end of
// each captured stack. Sentry derives an issue's culprit and grouping key from
// the innermost frame, so leaving these in groups every backend ERROR under the
// reporter instead of the failing call site. Nothing else about the event is
// changed: message, type, tags, level, and fingerprint are left alone.
func trimReportingFrames(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}
	for index := range event.Exception {
		stacktrace := event.Exception[index].Stacktrace
		if stacktrace == nil {
			continue
		}
		// Frames run oldest-first, so the machinery is at the tail.
		end := len(stacktrace.Frames)
		for end > 0 && isReportingFrame(stacktrace.Frames[end-1]) {
			end--
		}
		// Never emit a stackless exception; an all-machinery stack is still
		// better than none for locating the report.
		if end > 0 {
			stacktrace.Frames = stacktrace.Frames[:end]
		}
		// Indexed, not ranged by value: the flag has to land on the real frame.
		for index := range stacktrace.Frames {
			stacktrace.Frames[index].InApp = isApplicationFrame(stacktrace.Frames[index])
		}
	}
	return event
}

func (disabledReporter) Enabled() bool {
	return false
}

func (disabledReporter) SetEnabled(bool) error           { return nil }
func (disabledReporter) CaptureException(error, Context) {}
func (disabledReporter) CaptureLogError(string, Context) {}
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

func (r *sentryReporter) CaptureLogError(message string, context Context) {
	r.withHub(context, func(hub *sentry.Hub) {
		hub.CaptureException(LoggedError(message))
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
