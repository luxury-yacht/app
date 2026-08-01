package sentryreporting

import (
	"os"
	"strings"
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
	CaptureException(err error, context Context)
	CaptureMessage(message string, context Context)
	CapturePanic(recovered any, context Context)
	Shutdown(timeout time.Duration) bool
}

type disabledReporter struct{}

// ConfigFromEnvironment applies Sentry's standard runtime environment variables
// over values embedded by the application build.
func ConfigFromEnvironment(defaultDSN, defaultRelease, defaultEnvironment string) Config {
	return Config{
		DSN:         environmentValue("SENTRY_DSN", defaultDSN),
		Release:     environmentValue("SENTRY_RELEASE", defaultRelease),
		Environment: environmentValue("SENTRY_ENVIRONMENT", defaultEnvironment),
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

	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:                    config.DSN,
		Environment:            config.Environment,
		Release:                config.Release,
		AttachStacktrace:       true,
		EnableTracing:          false,
		DataCollection:         disabledDataCollection(),
		ServerName:             "luxury-yacht-desktop",
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

	return &sentryReporter{hub: sentry.NewHub(client, sentry.NewScope())}, nil
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

func (disabledReporter) CaptureException(error, Context) {}
func (disabledReporter) CaptureMessage(string, Context)  {}
func (disabledReporter) CapturePanic(any, Context)       {}
func (disabledReporter) Shutdown(time.Duration) bool     { return true }

type sentryReporter struct {
	hub *sentry.Hub
}

func (r *sentryReporter) Enabled() bool {
	return true
}

func (r *sentryReporter) CaptureMessage(message string, context Context) {
	hub := r.hubWithContext(context)
	hub.CaptureMessage(message)
}

func (r *sentryReporter) CaptureException(err error, context Context) {
	hub := r.hubWithContext(context)
	hub.CaptureException(err)
}

func (r *sentryReporter) CapturePanic(recovered any, context Context) {
	hub := r.hubWithContext(context)
	hub.Recover(recovered)
}

func (r *sentryReporter) Shutdown(timeout time.Duration) bool {
	flushed := r.hub.Flush(timeout)
	r.hub.Client().Close()
	return flushed
}

func (r *sentryReporter) hubWithContext(context Context) *sentry.Hub {
	hub := r.hub.Clone()
	hub.ConfigureScope(func(scope *sentry.Scope) {
		if context.Source != "" {
			scope.SetTag("source", context.Source)
		}
		if context.ClusterID != "" {
			scope.SetTag("clusterId", context.ClusterID)
		}
	})
	return hub
}
