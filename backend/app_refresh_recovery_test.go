package backend

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func TestHandlePermissionIssuesSchedulesRecovery(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	reasons := make([]string, 0, 1)
	app.startAuthRecovery = func(reason string) {
		reasons = append(reasons, reason)
		app.authRecoveryMu.Lock()
		app.authRecoveryScheduled = false
		app.authRecoveryMu.Unlock()
	}

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: errors.New("forbidden")}}
	app.handlePermissionIssues(issues)

	require.Equal(t, []string{"namespace (pods)"}, reasons)
}

func TestScheduleAuthRecoveryOnlyOnce(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	calls := 0
	app.startAuthRecovery = func(reason string) {
		calls++
	}

	issue := system.PermissionIssue{Domain: "cluster", Resource: "nodes", Err: errors.New("unauthorized")}
	app.scheduleAuthRecovery(issue)
	app.scheduleAuthRecovery(issue)

	require.Equal(t, 1, calls)

	app.authRecoveryMu.Lock()
	app.authRecoveryScheduled = false
	app.authRecoveryMu.Unlock()
}

func TestRunAuthRecoveryStopsWhenContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	app := newTestAppWithDefaults(t)
	app.Ctx = ctx
	app.authRecoveryMu.Lock()
	app.authRecoveryScheduled = true
	app.authRecoveryMu.Unlock()

	app.runAuthRecovery("reason")

	app.authRecoveryMu.Lock()
	scheduled := app.authRecoveryScheduled
	app.authRecoveryMu.Unlock()
	require.False(t, scheduled)
}

type stubListener struct {
	closed bool
}

func (s *stubListener) Accept() (net.Conn, error) { return nil, errors.New("not implemented") }
func (s *stubListener) Close() error              { s.closed = true; return nil }
func (s *stubListener) Addr() net.Addr            { return &net.TCPAddr{} }

func TestTeardownRefreshSubsystem(t *testing.T) {
	app := newTestAppWithDefaults(t)

	cancelled := false
	app.refreshCancel = func() { cancelled = true }

	listener := &stubListener{}
	app.refreshListener = listener
	app.refreshHTTPServer = &http.Server{}
	app.refreshBaseURL = "http://example"

	app.teardownRefreshSubsystem()

	require.True(t, cancelled)
	require.True(t, listener.closed)
	require.Nil(t, app.refreshListener)
	require.Nil(t, app.refreshHTTPServer)
	require.Empty(t, app.refreshBaseURL)
}

func TestRebuildRefreshSubsystemResetsClients(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	app.client = kubernetesfake.NewClientset()
	app.apiextensionsClient = &apiextensionsclientset.Clientset{}
	app.dynamicClient = dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
	app.metricsClient = &metricsclient.Clientset{}
	app.restConfig = &rest.Config{}

	cancelled := false
	app.refreshCancel = func() { cancelled = true }
	app.refreshListener = &stubListener{}
	app.refreshHTTPServer = &http.Server{}
	app.refreshBaseURL = "http://example"

	app.kubeClientInitializer = func() error { return nil }

	err := app.rebuildRefreshSubsystem("test")
	require.NoError(t, err)
	require.True(t, cancelled)
	require.Nil(t, app.client)
	require.Nil(t, app.apiextensionsClient)
	require.Nil(t, app.dynamicClient)
	require.Nil(t, app.metricsClient)
	require.Nil(t, app.restConfig)
	require.Empty(t, app.refreshBaseURL)
}

func TestRebuildRefreshSubsystemPropagatesError(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.kubeClientInitializer = func() error { return errors.New("boom") }

	err := app.rebuildRefreshSubsystem("test")
	require.Error(t, err)
}

func TestRunTransportRebuildSuccess(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.logger = NewLogger(10)
	app.telemetryRecorder = telemetry.NewRecorder()
	app.kubeClientInitializer = func() error { return nil }
	app.transportFailureCount = 2
	app.transportRebuildInProgress = true

	app.runTransportRebuild("retry", errors.New("original failure"))

	summary := app.telemetryRecorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Connection.TransportRebuilds)
	require.Equal(t, "retry", summary.Connection.LastTransportReason)
	require.Equal(t, ConnectionStateHealthy, app.connectionStatus)
	require.Zero(t, app.transportFailureCount)
	require.False(t, app.transportRebuildInProgress)
	require.True(t, app.transportWindowStart.IsZero())
	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Transport rebuild complete")
}

func TestRunTransportRebuildFailureSetsOffline(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.logger = NewLogger(10)
	app.telemetryRecorder = telemetry.NewRecorder()
	app.kubeClientInitializer = func() error { return errors.New("still broken") }
	app.transportRebuildInProgress = true

	app.runTransportRebuild("retry", nil)

	summary := app.telemetryRecorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Connection.TransportRebuilds)
	require.Equal(t, ConnectionStateOffline, app.connectionStatus)
	require.Zero(t, app.transportFailureCount)
	require.False(t, app.transportRebuildInProgress)
}

func TestRecordTransportSuccessResetsFailures(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.connectionStatus = ConnectionStateRetrying
	app.transportFailureCount = 2

	app.recordTransportSuccess()

	require.Equal(t, 0, app.transportFailureCount)
	require.Equal(t, ConnectionStateHealthy, app.connectionStatus)
}

func TestRecordTransportFailureTriggersRebuildAfterThreshold(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = NewLogger(10)
	app.Ctx = context.Background()

	app.recordTransportFailure("tls", errors.New("boom"))
	app.recordTransportFailure("tls", errors.New("boom"))
	app.recordTransportFailure("tls", errors.New("boom"))

	app.transportMu.Lock()
	inProgress := app.transportRebuildInProgress
	app.transportMu.Unlock()

	require.True(t, inProgress, "expected rebuild flag after threshold failures")
	require.Equal(t, ConnectionStateRebuilding, app.connectionStatus)
}
