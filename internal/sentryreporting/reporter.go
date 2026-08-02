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
		Dsn:            config.DSN,
		Environment:    config.Environment,
		Release:        config.Release,
		DataCollection: &sentry.DataCollection{},
		Transport:      config.Transport,
	})
	if err != nil {
		return nil, err
	}

	return sentry.NewHub(client, sentry.NewScope()), nil
}

// backendMessageError keeps application log failures exception-shaped so
// Sentry displays the original message and captures the call stack.
type backendMessageError string

func (e backendMessageError) Error() string {
	return string(e)
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
		hub.CaptureException(backendMessageError(message))
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
