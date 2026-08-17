package backend

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type capturedReport struct {
	message string
	context sentryreporting.Context
}

type capturedException struct {
	err     error
	context sentryreporting.Context
}

type capturedPanic struct {
	recovered any
	context   sentryreporting.Context
}

type recordingErrorReporter struct {
	mu             sync.Mutex
	messages       []capturedReport
	exceptions     []capturedException
	panics         []capturedPanic
	breadcrumbs    []sentryreporting.Breadcrumb
	enabled        bool
	enabledChanges []bool
	setEnabledFn   func(bool)
}

type loggerSentryTransport struct {
	event *sentry.Event
}

func (*loggerSentryTransport) Configure(sentry.ClientOptions) {}

func (t *loggerSentryTransport) SendEvent(event *sentry.Event) {
	t.event = event
}

func (*loggerSentryTransport) Flush(time.Duration) bool              { return true }
func (*loggerSentryTransport) FlushWithContext(context.Context) bool { return true }
func (*loggerSentryTransport) Close()                                {}

func captureLoggerFailureFromObjectCatalog(logger *Logger) {
	logger.Error("object catalog failed for private-cluster", "ObjectCatalog", "private-cluster")
}

// Mirrors how subsystems actually report: through a cluster-scoped applog
// wrapper rather than the concrete logger.
func captureScopedFailureFromCapabilities(logger applog.Logger) {
	applog.Error(logger, "capability check failed", "Capabilities")
}

func (r *recordingErrorReporter) Enabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enabled
}

func (r *recordingErrorReporter) SetEnabled(enabled bool) error {
	r.mu.Lock()
	r.enabled = enabled
	r.enabledChanges = append(r.enabledChanges, enabled)
	callback := r.setEnabledFn
	r.mu.Unlock()
	if callback != nil {
		callback(enabled)
	}
	return nil
}

func (r *recordingErrorReporter) CaptureException(err error, context sentryreporting.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.exceptions = append(r.exceptions, capturedException{err: err, context: context})
}
func (r *recordingErrorReporter) CapturePanic(recovered any, context sentryreporting.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.panics = append(r.panics, capturedPanic{recovered: recovered, context: context})
}
func (r *recordingErrorReporter) AddBreadcrumb(breadcrumb sentryreporting.Breadcrumb) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.breadcrumbs = append(r.breadcrumbs, breadcrumb)
}
func (*recordingErrorReporter) Shutdown(time.Duration) bool { return true }

func (r *recordingErrorReporter) CaptureLogError(message string, context sentryreporting.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.messages = append(r.messages, capturedReport{message: message, context: context})
}

func TestLoggerReportsOnlyErrorsWithClusterIdentity(t *testing.T) {
	reporter := &recordingErrorReporter{}
	logger := NewLogger(10, reporter)

	logger.Info("refresh started", "Refresh", "cluster-a", "Production")
	logger.Error("refresh failed", "Refresh", "cluster-a", "Production")

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []capturedReport{{
		message: "refresh failed",
		context: sentryreporting.Context{Source: "Refresh", ClusterID: "cluster-a", ClusterName: "Production"},
	}}, reporter.messages)
}

func TestLoggerRoutesNonErrorsWithBoundedMetadataAndLevelParity(t *testing.T) {
	reporter := &recordingErrorReporter{}
	logger := NewLogger(10, reporter)

	logger.Debug("debug message", "DebugSource", "cluster-a", "Production", "debug-op", "ignored")
	logger.Warn("warning message", "WarnSource")
	logger.log(LogLevel(99), "unknown-level message", nil, nil, sentryreporting.Operation{})

	reporter.mu.Lock()
	require.Equal(t, []sentryreporting.Breadcrumb{
		{
			Category:    "DebugSource",
			Message:     "debug message",
			Level:       "debug",
			Data:        map[string]any{"clusterId": "cluster-a", "clusterName": "Production"},
			OperationID: "debug-op",
		},
		{
			Category: "WarnSource",
			Message:  "warning message",
			Level:    "warning",
			Data:     map[string]any{},
		},
		{
			Message: "unknown-level message",
			Level:   "info",
			Data:    map[string]any{},
		},
	}, reporter.breadcrumbs)
	reporter.mu.Unlock()

	entries := logger.GetEntries()
	require.Len(t, entries, 3)
	require.Equal(t, LogEntry{
		Sequence:    1,
		Timestamp:   entries[0].Timestamp,
		Level:       "DEBUG",
		Message:     "debug message",
		Source:      "DebugSource",
		ClusterID:   "cluster-a",
		ClusterName: "Production",
		OperationID: "debug-op",
	}, entries[0])
	require.Equal(t, "UNKNOWN", entries[2].Level)
}

func TestNilLoggerIgnoresLog(t *testing.T) {
	var logger *Logger
	require.NotPanics(t, func() {
		logger.Log(LogLevelError, "ignored")
	})
}

func TestLoggerReportsStructuredErrorWithoutFlatteningCause(t *testing.T) {
	reporter := &recordingErrorReporter{}
	base := NewLogger(10, reporter)
	logger := applog.ClusterScoped(base, "cluster-a", "Production")
	cause := errors.New("forbidden")
	operation := sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
		Action:   sentryreporting.KubernetesActionGet,
		Group:    "apps",
		Version:  "v1",
		Resource: "deployments",
		Scope:    sentryreporting.KubernetesScopeNamespaced,
	})

	applog.ReportErrorWithOperation(logger, cause, "Failed to get deployment default/web", operation, "ResourceLoader")

	reporter.mu.Lock()
	require.Empty(t, reporter.messages)
	require.Equal(t, []capturedException{{
		err: cause,
		context: sentryreporting.Context{
			Source:      "ResourceLoader",
			ClusterID:   "cluster-a",
			ClusterName: "Production",
			Operation:   operation,
		},
	}}, reporter.exceptions)
	reporter.mu.Unlock()

	entries := base.GetEntries()
	require.Len(t, entries, 1)
	require.Equal(t, "Failed to get deployment default/web: forbidden", entries[0].Message)
}

func TestLoggerKeepsExpectedClusterFailuresLocal(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{
			name: "authentication",
			err: fmt.Errorf(
				"request failed: %w",
				&authstate.AuthInvalidError{Reason: "credentials rejected"},
			),
		},
		{
			name: "raw structured authentication",
			err:  apierrors.NewUnauthorized("credentials rejected"),
		},
		{
			name: "wrapped structured not found",
			err: fmt.Errorf(
				"resource fetch failed: %w",
				apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "pod-a"),
			),
		},
		{
			name: "raw credential helper failure",
			err:  errors.New("getting credentials: exec: executable aws failed with exit code 255"),
		},
		{
			name: "connectivity",
			err: &url.Error{
				Op:  "Get",
				URL: "https://cluster.example.test",
				Err: errors.New("connection refused"),
			},
		},
		{
			name: "URL timeout",
			err: &url.Error{
				Op:  "Get",
				URL: "https://cluster.example.test",
				Err: context.DeadlineExceeded,
			},
		},
		{
			name: "cancellation",
			err:  context.Canceled,
		},
		{
			name: "API server unavailable",
			err:  apierrors.NewServiceUnavailable("cluster temporarily unavailable"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reporter := &recordingErrorReporter{}
			logger := NewLogger(10, reporter)

			logger.ErrorWithCause(tt.err, "cluster request failed", "ResourceLoader", "cluster-a", "Production")

			reporter.mu.Lock()
			require.Empty(t, reporter.messages)
			require.Empty(t, reporter.exceptions)
			reporter.mu.Unlock()

			entries := logger.GetEntries()
			require.Len(t, entries, 1)
			require.Equal(t, "ERROR", entries[0].Level)
			require.Contains(t, entries[0].Message, tt.err.Error())
		})
	}
}

func TestLoggerReportsDeadlineAndUnexpectedURLFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{name: "deadline exceeded", err: context.DeadlineExceeded},
		{
			name: "URL application failure",
			err: &url.Error{
				Op:  "Get",
				URL: "https://cluster.example.test",
				Err: errors.New("redirect policy rejected"),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reporter := &recordingErrorReporter{}
			logger := NewLogger(10, reporter)

			logger.ErrorWithCause(tt.err, "cluster request failed", "ResourceLoader", "cluster-a", "Production")

			reporter.mu.Lock()
			require.Empty(t, reporter.messages)
			require.Len(t, reporter.exceptions, 1)
			require.ErrorIs(t, reporter.exceptions[0].err, tt.err)
			reporter.mu.Unlock()
		})
	}
}

func TestLoggerSentryReportIncludesOriginalMessageAndCluster(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := NewLogger(10, reporter)

	captureLoggerFailureFromObjectCatalog(logger)

	require.NotNil(t, transport.event)
	require.Equal(t, "object catalog failed for cluster-1", transport.event.Exception[0].Value)
	require.Equal(t, "cluster-1", transport.event.Tags["cluster.alias"])
	require.NotContains(t, transport.event.Tags, "clusterId")
	require.Empty(t, transport.event.Fingerprint)
}

func TestLoggerAddsApplicationTrailAsBreadcrumbsBeforeStructuredError(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := NewLogger(10, reporter)

	logger.Info("refresh started", "Refresh", "cluster-a", "Production", "backend-op-1")
	logger.Warn("retrying workload fetch", "ResourceLoader", "cluster-a", "Production", "backend-op-1")
	logger.ErrorWithCauseAndOperation(
		errors.New("forbidden"),
		"Failed to get deployment default/web",
		sentryreporting.NewKubernetesRequestOperation(sentryreporting.KubernetesRequest{
			Action:   sentryreporting.KubernetesActionGet,
			Group:    "apps",
			Version:  "v1",
			Resource: "deployments",
			Scope:    sentryreporting.KubernetesScopeNamespaced,
		}),
		"ResourceLoader",
		"cluster-a",
		"Production",
		"backend-op-1",
	)

	require.NotNil(t, transport.event)
	require.Len(t, transport.event.Breadcrumbs, 2)
	require.Equal(t, "Refresh", transport.event.Breadcrumbs[0].Category)
	require.Equal(t, "refresh started", transport.event.Breadcrumbs[0].Message)
	require.Equal(t, sentry.LevelInfo, transport.event.Breadcrumbs[0].Level)
	require.Equal(t, "cluster-1", transport.event.Breadcrumbs[0].Data["cluster.alias"])
	require.Equal(t, "backend-op-1", transport.event.Breadcrumbs[0].Data["operationId"])
	require.NotContains(t, transport.event.Breadcrumbs[0].Data, "clusterId")
	require.NotContains(t, transport.event.Breadcrumbs[0].Data, "clusterName")
	require.Equal(t, sentry.LevelWarning, transport.event.Breadcrumbs[1].Level)
	require.Equal(t, map[string]any{
		"type":     "kubernetes.request",
		"action":   "get",
		"group":    "apps",
		"version":  "v1",
		"resource": "deployments",
		"scope":    "namespaced",
	}, transport.event.Contexts["error"]["operation"])
}

func TestLoggerForwardsOperationIdentityToBreadcrumbsAndError(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := NewLogger(10, reporter)

	logger.Info("refresh started", "Refresh", "cluster-a", "Production", "backend-op-3")
	logger.ErrorWithCause(
		errors.New("forbidden"),
		"Failed to get deployment default/web",
		"ResourceLoader",
		"cluster-a",
		"Production",
		"backend-op-3",
	)

	require.NotNil(t, transport.event)
	require.Len(t, transport.event.Breadcrumbs, 1)
	require.Equal(t, "backend-op-3", transport.event.Breadcrumbs[0].Data["operationId"])
	require.Equal(t, "backend-op-3", transport.event.Tags["operation.id"])
	require.Equal(t, "backend-op-3", transport.event.Contexts["error"]["operationId"])
}

func TestFetchResourceReportsOriginalKubernetesError(t *testing.T) {
	reporter := &recordingErrorReporter{}
	app := NewApp(nil, reporter)
	cause := apierrors.NewForbidden(
		schema.GroupResource{Group: "apps", Resource: "deployments"},
		"web",
		errors.New("RBAC denied the request"),
	)

	_, err := FetchResourceWithSelection(
		app.resources,
		"cluster-a",
		"deployment/default/web",
		"Deployment",
		"default/web",
		func(context.Context) (string, error) { return "", cause },
	)
	require.Error(t, err)

	reporter.mu.Lock()
	require.Empty(t, reporter.messages)
	require.Len(t, reporter.exceptions, 1)
	require.Same(t, cause, reporter.exceptions[0].err)
	require.Equal(t, sentryreporting.Operation{}, reporter.exceptions[0].context.Operation)
	require.Equal(t, "cluster-a", reporter.exceptions[0].context.ClusterID)
	reporter.mu.Unlock()
}

func TestFetchResourceDoesNotReportTelemetryHandledErrorAgain(t *testing.T) {
	reporter := &recordingErrorReporter{}
	app := NewApp(nil, reporter)
	cause := errors.New("already reported")

	_, err := FetchResourceWithSelection(
		app.resources,
		"cluster-a",
		"deployment/default/web",
		"Deployment",
		"default/web",
		func(context.Context) (string, error) { return "", errorcapture.MarkTelemetryHandled(cause) },
	)
	require.Error(t, err)
	require.ErrorIs(t, err, cause)

	reporter.mu.Lock()
	require.Empty(t, reporter.messages)
	require.Empty(t, reporter.exceptions)
	reporter.mu.Unlock()
}

func TestLoggerReportsRecoveredPanicWithoutFlattening(t *testing.T) {
	reporter := &recordingErrorReporter{}
	base := NewLogger(10, reporter)
	logger := applog.ClusterScoped(base, "cluster-a", "Production")

	applog.ReportPanic(logger, "boom", "containerlogsstream: panic in stream handler", "ContainerLogsStream")

	reporter.mu.Lock()
	require.Empty(t, reporter.messages)
	require.Equal(t, []capturedPanic{{
		recovered: "boom",
		context: sentryreporting.Context{
			Source:      "ContainerLogsStream",
			ClusterID:   "cluster-a",
			ClusterName: "Production",
		},
	}}, reporter.panics)
	reporter.mu.Unlock()

	entries := base.GetEntries()
	require.Len(t, entries, 1)
	require.Equal(t, "containerlogsstream: panic in stream handler: boom", entries[0].Message)
}

// Cross-layer guard: the application logger and the reporter both sit between
// the failing code and Sentry. If either layer's frames survive into the
// reported stack, Sentry attributes every backend ERROR to the logging
// plumbing rather than to the code that failed.
func TestLoggerSentryReportPointsAtTheCodeThatLogged(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := NewLogger(10, reporter)

	captureLoggerFailureFromObjectCatalog(logger)

	require.NotNil(t, transport.event)
	require.Len(t, transport.event.Exception, 1)
	stacktrace := transport.event.Exception[0].Stacktrace
	require.NotNil(t, stacktrace)
	require.NotEmpty(t, stacktrace.Frames)

	for _, frame := range stacktrace.Frames {
		require.NotEqual(t, "github.com/luxury-yacht/app/internal/sentry", frame.Module)
		require.NotEqual(t, "github.com/luxury-yacht/app/backend/internal/applog", frame.Module)
		require.NotContains(t, frame.Function, "(*Logger).")
	}
	innermost := stacktrace.Frames[len(stacktrace.Frames)-1]
	require.Equal(t, "captureLoggerFailureFromObjectCatalog", innermost.Function)
}

// The reported shape from a real subsystem adds the applog wrapper layers
// between the failing code and the logger.
func TestScopedLoggerSentryReportPointsAtTheCodeThatLogged(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := applog.ClusterScoped(NewLogger(10, reporter), "cluster-a", "Alpha")

	captureScopedFailureFromCapabilities(logger)

	require.NotNil(t, transport.event)
	require.Len(t, transport.event.Exception, 1)
	stacktrace := transport.event.Exception[0].Stacktrace
	require.NotNil(t, stacktrace)
	require.NotEmpty(t, stacktrace.Frames)

	innermost := stacktrace.Frames[len(stacktrace.Frames)-1]
	require.Equal(t, "captureScopedFailureFromCapabilities", innermost.Function)
	require.Equal(t, "capability check failed", transport.event.Exception[0].Value)
	require.Equal(t, "cluster-1", transport.event.Tags["cluster.alias"])
	require.NotContains(t, transport.event.Tags, "clusterId")
}

// ErrorCapture republishes third-party stderr — klog lines from client-go and
// friends — at whatever severity they claim. Those are not this application
// failing, and their stack is the scraper, so they must stay out of the
// reporter while remaining visible in the local application log.
func TestLoggerDoesNotReportScrapedThirdPartyOutput(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := NewLogger(10, reporter)

	logger.Error(
		`E0802 21:57:32 request.go:1196] "Unexpected error when reading response body" err="http2: client connection lost"`,
		logsources.ErrorCapture,
	)

	require.Nil(t, transport.event, "scraped third-party output must not reach Sentry")

	entries := logger.GetEntries()
	require.Len(t, entries, 1)
	require.Equal(t, "ERROR", entries[0].Level)
	require.Equal(t, logsources.ErrorCapture, entries[0].Source)
}

func TestNewAppPassesErrorReporterToApplicationLogger(t *testing.T) {
	reporter := &recordingErrorReporter{}
	app := NewApp(nil, reporter)

	app.appLogs.logger.Error("startup failed", "App")

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []capturedReport{{
		message: "startup failed",
		context: sentryreporting.Context{Source: "App"},
	}}, reporter.messages)
}
