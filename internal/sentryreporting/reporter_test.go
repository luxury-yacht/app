package sentryreporting

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"
)

type recordingTransport struct {
	mu      sync.Mutex
	options sentry.ClientOptions
	events  []*sentry.Event
	flushed bool
	closed  bool
}

func (t *recordingTransport) Configure(options sentry.ClientOptions) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.options = options
}

func (t *recordingTransport) SendEvent(event *sentry.Event) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, event)
}

func (t *recordingTransport) Flush(time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.flushed = true
	return true
}

func (t *recordingTransport) FlushWithContext(context.Context) bool {
	return t.Flush(0)
}

func (t *recordingTransport) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
}

func (t *recordingTransport) lastEvent() *sentry.Event {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.events) == 0 {
		return nil
	}
	return t.events[len(t.events)-1]
}

func (t *recordingTransport) eventCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.events)
}

func TestNewReturnsDisabledReporterWithoutDSN(t *testing.T) {
	reporter, err := New(Config{})

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestControlledReporterStartsDisabledAndStopsWithoutFlushing(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := NewDisabled(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	require.False(t, reporter.Enabled())

	reporter.CaptureLogError("before opt in", Context{ClusterID: "cluster-a"})
	require.Zero(t, transport.eventCount())

	require.NoError(t, reporter.SetEnabled(true))
	require.True(t, reporter.Enabled())
	reporter.CaptureLogError("after opt in", Context{ClusterID: "cluster-a"})
	require.Equal(t, 1, transport.eventCount())

	require.NoError(t, reporter.SetEnabled(false))
	require.False(t, reporter.Enabled())
	reporter.CaptureLogError("after opt out", Context{ClusterID: "cluster-a"})
	require.Equal(t, 1, transport.eventCount())

	transport.mu.Lock()
	defer transport.mu.Unlock()
	require.True(t, transport.closed)
	require.False(t, transport.flushed)
}

func TestReporterCapturesOriginalMessageAndContext(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:         "https://public@example.com/1",
		Environment: "production",
		Release:     "luxury-yacht@v1.2.3",
		Transport:   transport,
	})
	require.NoError(t, err)

	reporter.CaptureLogError("refresh subsystem failed for cluster-a", Context{
		Source:    "Refresh",
		ClusterID: "cluster-a",
	})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Empty(t, event.Message)
	require.Equal(t, "production", event.Environment)
	require.Equal(t, "luxury-yacht@v1.2.3", event.Release)
	require.Equal(t, "Refresh", event.Tags["source"])
	require.Equal(t, "cluster-a", event.Tags["clusterId"])
	require.Len(t, event.Tags, 2)
	require.Empty(t, event.Fingerprint)
	require.Len(t, event.Exception, 1)
	// Sentry renders an issue's title as "<type>: <value>", and sentry-go fills
	// the type from the Go type name, so this string is read by anyone triaging.
	require.Equal(t, "sentryreporting.LoggedError", event.Exception[0].Type)
	require.Equal(t, "refresh subsystem failed for cluster-a", event.Exception[0].Value)
	require.NotNil(t, event.Exception[0].Stacktrace)
	require.NotEmpty(t, event.Exception[0].Stacktrace.Frames)
}

// Sentry derives an issue's culprit and grouping key from the innermost frame.
// The reporter's own frames sit on top of every captured stack, so leaving them
// in makes each report group under the reporter instead of the failing code.
func TestReporterTrimsItsOwnFramesFromReportedStacks(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CaptureLogError("refresh subsystem failed", Context{Source: "Refresh"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Len(t, event.Exception, 1)
	stacktrace := event.Exception[0].Stacktrace
	require.NotNil(t, stacktrace)
	require.NotEmpty(t, stacktrace.Frames)

	for _, frame := range stacktrace.Frames {
		require.NotContains(t, frame.Function, "(*sentryReporter).")
	}
	innermost := stacktrace.Frames[len(stacktrace.Frames)-1]
	require.Equal(t, "TestReporterTrimsItsOwnFramesFromReportedStacks", innermost.Function)
}

// Most backend packages wrap the application logger in a one-line logError
// helper. That wrapper is the innermost application frame, so without trimming
// it Sentry names the wrapper as the culprit instead of the failing code —
// observed live as "backend/capabilities in (*Service).logError".
type fakeLoggingService struct{ reporter Reporter }

func (s *fakeLoggingService) logError(message string) {
	s.reporter.CaptureLogError(message, Context{Source: "Fake"})
}

func captureThroughLogWrapper(service *fakeLoggingService) {
	service.logError("41 of 68 capability checks failed")
}

func TestReporterTrimsPerPackageLogWrappers(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	captureThroughLogWrapper(&fakeLoggingService{reporter: reporter})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Len(t, event.Exception, 1)
	stacktrace := event.Exception[0].Stacktrace
	require.NotNil(t, stacktrace)
	require.NotEmpty(t, stacktrace.Frames)

	innermost := stacktrace.Frames[len(stacktrace.Frames)-1]
	require.Equal(t, "captureThroughLogWrapper", innermost.Function)
}

// Sentry groups only on frames the SDK marks as belonging to the application,
// and sentry-go marks everything outside GOROOT as in-app — including Wails and
// client-go. That couples the grouping key to dependency internals, so a
// dependency upgrade that moves a module or renames a function re-groups
// unrelated issues. Only this module's own frames are application frames.
func TestReporterMarksOnlyApplicationFramesInApp(t *testing.T) {
	event := &sentry.Event{Exception: []sentry.Exception{{
		Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{
			{Module: "github.com/wailsapp/wails/v2/internal/frontend/dispatcher", Function: "(*Dispatcher).ProcessMessage", InApp: true},
			{Module: "k8s.io/client-go/rest", Function: "(*Request).Do", InApp: true},
			{Module: "main", Function: "reportRunError", InApp: true},
			{Module: "github.com/luxury-yacht/app/backend/capabilities", Function: "(*Service).Evaluate", InApp: true},
		}},
	}}}

	trimmed := trimReportingFrames(event, nil)

	frames := trimmed.Exception[0].Stacktrace.Frames
	require.Len(t, frames, 4)
	require.False(t, frames[0].InApp, "Wails frames are not application code")
	require.False(t, frames[1].InApp, "client-go frames are not application code")
	require.True(t, frames[2].InApp, "package main is application code")
	require.True(t, frames[3].InApp, "the app's own packages are application code")
}

// Observed live as LUXURY-YACHT-BACKEND-M, culprited at
// "resources/common in Dependencies.LogRequestFailure". Forwarders are not
// detectable from a stack — each one has to be registered here, so this test
// pins the real shapes rather than the matching rule.
func TestReporterTrimsRegisteredLogForwarders(t *testing.T) {
	realCallSite := sentry.Frame{
		Module:   "github.com/luxury-yacht/app/backend/resources/deployment",
		Function: "(*Service).Deployment",
	}
	forwarders := []sentry.Frame{
		{Module: "github.com/luxury-yacht/app/backend/resources/common", Function: "Dependencies.LogRequestFailure"},
		{Module: "github.com/luxury-yacht/app/backend/capabilities", Function: "(*Service).logError"},
	}

	for _, forwarder := range forwarders {
		t.Run(forwarder.Function, func(t *testing.T) {
			event := &sentry.Event{Exception: []sentry.Exception{{
				Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{realCallSite, forwarder}},
			}}}

			frames := trimReportingFrames(event, nil).Exception[0].Stacktrace.Frames

			require.Len(t, frames, 1)
			require.Equal(t, "(*Service).Deployment", frames[0].Function)
		})
	}
}

// The SDK only takes the buffered telemetry path when no custom Transport is
// configured (sentry-go client.go: !DisableTelemetryBuffer && Transport == nil).
// Every test here injects a Transport, so the buffered path is never exercised
// by tests and only ever runs in packaged builds. That path makes Client.Close
// flush (scheduler.Stop calls Flush first), which would invert opt-out and
// block the settings goroutine. Pin the option instead of the side effect.
func TestReporterDisablesTelemetryBufferSoOptOutDiscardsBufferedEvents(t *testing.T) {
	transport := &recordingTransport{}
	_, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	transport.mu.Lock()
	options := transport.options
	transport.mu.Unlock()

	require.True(t, options.DisableTelemetryBuffer)
}

func TestReporterUsesSentryDataCollectionDefaults(t *testing.T) {
	transport := &recordingTransport{}
	_, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	transport.mu.Lock()
	options := transport.options
	transport.mu.Unlock()

	require.NotNil(t, options.DataCollection)
	require.True(t, options.DataCollection.UserInfo.Value)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.Cookies.Mode)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.HTTPHeaders.Request.Mode)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.HTTPHeaders.Response.Mode)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.QueryParams.Mode)
	require.ElementsMatch(t, []sentry.BodyType{
		sentry.BodyIncomingRequest,
		sentry.BodyOutgoingRequest,
		sentry.BodyIncomingResponse,
	}, options.DataCollection.HTTPBodies)
}

func TestReporterCapturesExceptions(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CaptureException(errors.New("wails failed for cluster-a"), Context{
		Source:      "Wails",
		ClusterID:   "cluster-a",
		ClusterName: "Production",
		Operation:   "start Wails application",
	})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.NotEmpty(t, event.Exception)
	require.Equal(t, "wails failed for cluster-a", event.Exception[0].Value)
	require.Equal(t, "Wails", event.Tags["source"])
	require.Equal(t, "cluster-a", event.Tags["clusterId"])
	require.Equal(t, "Production", event.Tags["clusterName"])
	require.Equal(t, "start Wails application", event.Contexts["error"]["operation"])
}

func TestReporterAttachesBreadcrumbsToFollowingException(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.AddBreadcrumb(Breadcrumb{
		Category: "Refresh",
		Message:  "refresh started",
		Level:    "info",
		Data: map[string]any{
			"clusterId":   "cluster-a",
			"clusterName": "Production",
		},
	})
	reporter.CaptureException(errors.New("refresh failed"), Context{Source: "Refresh", ClusterID: "cluster-a"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Len(t, event.Breadcrumbs, 1)
	require.Equal(t, "Refresh", event.Breadcrumbs[0].Category)
	require.Equal(t, "refresh started", event.Breadcrumbs[0].Message)
	require.Equal(t, sentry.LevelInfo, event.Breadcrumbs[0].Level)
	require.Equal(t, "cluster-a", event.Breadcrumbs[0].Data["clusterId"])
	require.Equal(t, "Production", event.Breadcrumbs[0].Data["clusterName"])
}

func TestReporterKeepsBreadcrumbsIsolatedByCluster(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.AddBreadcrumb(Breadcrumb{Category: "App", Message: "global action", Level: "info"})
	reporter.AddBreadcrumb(Breadcrumb{
		Category: "Refresh",
		Message:  "cluster-a action",
		Level:    "info",
		Data:     map[string]any{"clusterId": "cluster-a"},
	})
	reporter.AddBreadcrumb(Breadcrumb{
		Category: "Refresh",
		Message:  "cluster-b action",
		Level:    "info",
		Data:     map[string]any{"clusterId": "cluster-b"},
	})
	reporter.CaptureException(errors.New("cluster-a failed"), Context{ClusterID: "cluster-a"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Len(t, event.Breadcrumbs, 2)
	require.Equal(t, "global action", event.Breadcrumbs[0].Message)
	require.Equal(t, "cluster-a action", event.Breadcrumbs[1].Message)
}

func TestReporterAddsKubernetesStatusTagsToWrappedException(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	statusErr := apierrors.NewForbidden(
		schema.GroupResource{Group: "apps", Resource: "deployments"},
		"web",
		errors.New("RBAC denied the request"),
	)
	wrapped := fmt.Errorf("load workload: %w", statusErr)

	reporter.CaptureException(wrapped, Context{Source: "ResourceLoader", ClusterID: "cluster-a"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Equal(t, "Forbidden", event.Tags["k8s.reason"])
	require.Equal(t, "403", event.Tags["http.status_code"])
	require.GreaterOrEqual(t, len(event.Exception), 2, "wrapped cause chain must remain exception-shaped")
}

func TestReporterAddsKubernetesFieldCausesToContext(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	statusErr := apierrors.NewInvalid(
		schema.GroupKind{Group: "apps", Kind: "Deployment"},
		"web",
		field.ErrorList{field.Invalid(field.NewPath("spec", "replicas"), -1, "must be non-negative")},
	)

	reporter.CaptureException(statusErr, Context{Source: "ResourceLoader", ClusterID: "cluster-a"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	kubernetesContext := event.Contexts["kubernetes"]
	require.Equal(t, "Invalid", kubernetesContext["reason"])
	require.Equal(t, int32(422), kubernetesContext["code"])
	causes, ok := kubernetesContext["causes"].([]map[string]any)
	require.True(t, ok)
	require.Len(t, causes, 1)
	require.Equal(t, "spec.replicas", causes[0]["field"])
	require.Contains(t, causes[0]["message"], "must be non-negative")
}

func TestReporterCapturesRecoveredPanics(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CapturePanic("boom for cluster-a", Context{Source: "Process"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Equal(t, "boom for cluster-a", event.Message)
	require.Equal(t, sentry.LevelFatal, event.Level)
	require.Equal(t, "Process", event.Tags["source"])
}

func TestReporterFlushesAndClosesTransportAtShutdown(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	require.True(t, reporter.Shutdown(time.Second))

	transport.mu.Lock()
	defer transport.mu.Unlock()
	require.True(t, transport.flushed)
	require.True(t, transport.closed)
}

func TestConfigFromEnvironmentUsesOnlyStandardizedBackendDSN(t *testing.T) {
	t.Setenv("SENTRY_BACKEND_DSN", " https://runtime@example.com/2 ")

	config := ConfigFromEnvironment(
		"https://build@example.com/1",
		"luxury-yacht@v1.2.3",
		"production",
	)

	require.Equal(t, "https://runtime@example.com/2", config.DSN)
	require.Equal(t, "luxury-yacht@v1.2.3", config.Release)
	require.Equal(t, "production", config.Environment)
}
