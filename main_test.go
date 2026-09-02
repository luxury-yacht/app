package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	testCompositionOnce sync.Once
	testComposition     *applicationComposition
)

func sharedTestComposition() *applicationComposition {
	testCompositionOnce.Do(func() {
		testComposition = newApplicationComposition(&mainRecordingReporter{}, compositionOptions{
			SingleInstance:         true,
			SingleInstanceUniqueID: testSingleInstanceID(),
		})
	})
	return testComposition
}

func testSingleInstanceID() string {
	return fmt.Sprintf("%s.test.%d", applicationProductIdentifier, os.Getpid())
}

type mainRecordingReporter struct {
	panics     []any
	exceptions []error
}

type recordingNativeWindowRegistry struct {
	calls []string
}

func (registry *recordingNativeWindowRegistry) record(call string) {
	registry.calls = append(registry.calls, call)
}

func (registry *recordingNativeWindowRegistry) PrepareApplicationQuit() bool {
	registry.record("prepare-quit")
	return false
}

func (registry *recordingNativeWindowRegistry) FocusMostRecent() {
	registry.record("focus-most-recent")
}

func (registry *recordingNativeWindowRegistry) Create(bool) *application.WebviewWindow {
	registry.record("create-workspace")
	return nil
}

func (registry *recordingNativeWindowRegistry) WindowDescriptor(
	string,
) (panelwindow.NativeDescriptor, error) {
	registry.record("window-descriptor")
	return panelwindow.NativeDescriptor{Role: panelwindow.NativeRoleWorkspace}, nil
}

func (registry *recordingNativeWindowRegistry) BeginPanelWindowOpen(
	panelwindow.GroupSnapshot,
) (panelwindow.WindowDescriptor, error) {
	registry.record("begin-open")
	return panelwindow.WindowDescriptor{}, nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowReady(
	string,
	string,
) (panelwindow.WindowDescriptor, error) {
	registry.record("acknowledge-ready")
	return panelwindow.WindowDescriptor{}, nil
}

func (registry *recordingNativeWindowRegistry) BeginPanelWindowDock(
	string,
	string,
	panelwindow.GroupSnapshot,
) error {
	registry.record("begin-dock")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowDock(string, string, string) error {
	registry.record("acknowledge-dock")
	return nil
}

func (registry *recordingNativeWindowRegistry) FailPanelWindowTransfer(string, string, string) error {
	registry.record("fail-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) FocusPanelWindow(string, string, string) error {
	registry.record("focus-panel")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelWindowClose(string, string, string) error {
	registry.record("request-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowClose(string) error {
	registry.record("acknowledge-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgeWorkspaceWindowClose(string) error {
	registry.record("acknowledge-workspace-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) RoutePanelWindowCommand(string, string) error {
	registry.record("route-command")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelObjectOpen(
	string,
	panelwindow.ObjectReference,
	string,
) error {
	registry.record("request-object-open")
	return nil
}

func (registry *recordingNativeWindowRegistry) AuthorizePanelObjectOpen(
	string,
	string,
	string,
	panelwindow.ObjectReference,
	string,
) error {
	registry.record("authorize-object-open")
	return nil
}

func (registry *recordingNativeWindowRegistry) UpdatePanelWindowSnapshot(
	string,
	panelwindow.GroupSnapshot,
) error {
	registry.record("update-snapshot")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelTabClose(string, string) error {
	registry.record("request-tab-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) AuthorizePanelTabClose(string, string, string) error {
	registry.record("authorize-tab-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelTabTransfer(
	string,
	panelwindow.TabTransferRequest,
) error {
	registry.record("request-tab-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcceptPanelTabTransfer(string, string) error {
	registry.record("accept-tab-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) FailPanelTabTransfer(string, string) error {
	registry.record("fail-tab-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelWindowGuard(
	string,
	string,
	string,
	string,
) error {
	registry.record("request-guard")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowGuard(
	string,
	string,
	bool,
) error {
	registry.record("acknowledge-guard")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgeApplicationQuitPreflight(
	string,
	string,
	bool,
) error {
	registry.record("acknowledge-quit")
	return nil
}

func (*mainRecordingReporter) Enabled() bool                                   { return true }
func (*mainRecordingReporter) SetEnabled(bool) error                           { return nil }
func (*mainRecordingReporter) CaptureLogError(string, sentryreporting.Context) {}
func (*mainRecordingReporter) AddBreadcrumb(sentryreporting.Breadcrumb)        {}
func (*mainRecordingReporter) Shutdown(time.Duration) bool                     { return true }

func (r *mainRecordingReporter) CaptureException(err error, _ sentryreporting.Context) {
	r.exceptions = append(r.exceptions, err)
}

func (r *mainRecordingReporter) CapturePanic(recovered any, _ sentryreporting.Context) {
	r.panics = append(r.panics, recovered)
}

func TestReportPanicCapturesAndRethrows(t *testing.T) {
	reporter := &mainRecordingReporter{}

	func() {
		defer func() {
			require.Equal(t, "boom", recover())
		}()
		func() {
			defer reportPanic(reporter)
			panic("boom")
		}()
	}()

	require.Equal(t, []any{"boom"}, reporter.panics)
}

func TestReportRunErrorCapturesOnlyFailures(t *testing.T) {
	reporter := &mainRecordingReporter{}
	failure := errors.New("webview failed")

	reportRunError(reporter, nil)
	reportRunError(reporter, failure)

	require.Equal(t, []error{failure}, reporter.exceptions)
}

func TestDefaultSentryReleaseUsesVersionedBuildIdentity(t *testing.T) {
	require.Equal(t, "luxury-yacht@v1.2.3", defaultSentryRelease(" v1.2.3 "))
	require.Empty(t, defaultSentryRelease("dev"))
}

func TestWindowRegistryBridgePreservesUnboundStartupSemantics(t *testing.T) {
	bridge := &windowRegistryBridge{}
	options := bridge.runtimeOptions(&mainRecordingReporter{}, backend.ApplicationUpdateOptions{})

	require.True(t, bridge.prepareApplicationQuit())
	require.False(t, options.IsWorkspaceWindow("workspace-1"))
	require.NotPanics(t, options.CreateWorkspaceWindow)
	_, err := options.NativeWindowDescriptor("workspace-1")
	require.ErrorContains(t, err, "native window registry is not available")
	_, err = options.BeginPanelWindowOpen(panelwindow.GroupSnapshot{})
	require.ErrorContains(t, err, "native window registry is not available")
	_, err = options.AcknowledgePanelReady("panel-1", "transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.BeginPanelWindowDock("panel-1", "right", panelwindow.GroupSnapshot{})
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgePanelDock("workspace-1", "panel-1", "transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.FailPanelTransfer("workspace-1", "panel-1", "transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.FocusPanelWindow("workspace-1", "panel-1", "tab-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelClose("workspace-1", "panel-1", "close")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgePanelClose("panel-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgeWorkspaceClose("workspace-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RoutePanelCommand("panel-1", "command")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelObjectOpen("panel-1", panelwindow.ObjectReference{}, "details")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AuthorizePanelObjectOpen(
		"workspace-1",
		"panel-1",
		"tab-1",
		panelwindow.ObjectReference{},
		"details",
	)
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.UpdatePanelSnapshot("panel-1", panelwindow.GroupSnapshot{})
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelTabClose("panel-1", "tab-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AuthorizePanelTabClose("workspace-1", "panel-1", "tab-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelTabTransfer("panel-1", panelwindow.TabTransferRequest{})
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcceptPanelTabTransfer("workspace-1", "tab-transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.FailPanelTabTransfer("panel-1", "tab-transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelGuard("workspace-1", "panel-1", "guard-1", "close")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgePanelGuard("panel-1", "guard-1", true)
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgeApplicationQuit("workspace-1", "quit-1", true)
	require.ErrorContains(t, err, "native window registry is not available")
}

func TestWindowRegistryBridgeForwardsEveryRuntimeOperationAfterBinding(t *testing.T) {
	registry := &recordingNativeWindowRegistry{}
	bridge := &windowRegistryBridge{}
	bridge.bind(registry)
	options := bridge.runtimeOptions(&mainRecordingReporter{}, backend.ApplicationUpdateOptions{})
	snapshot := panelwindow.GroupSnapshot{}
	objectRef := panelwindow.ObjectReference{}

	require.False(t, bridge.prepareApplicationQuit())
	bridge.onSecondInstanceLaunch(application.SecondInstanceData{})
	options.CreateWorkspaceWindow()
	require.True(t, options.IsWorkspaceWindow("workspace-1"))
	_, err := options.NativeWindowDescriptor("workspace-1")
	require.NoError(t, err)
	_, err = options.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	_, err = options.AcknowledgePanelReady("panel-1", "transfer-1")
	require.NoError(t, err)
	require.NoError(t, options.BeginPanelWindowDock("panel-1", "right", snapshot))
	require.NoError(t, options.AcknowledgePanelDock("workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, options.FailPanelTransfer("workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, options.FocusPanelWindow("workspace-1", "panel-1", "tab-1"))
	require.NoError(t, options.RequestPanelClose("workspace-1", "panel-1", "close"))
	require.NoError(t, options.AcknowledgePanelClose("panel-1"))
	require.NoError(t, options.AcknowledgeWorkspaceClose("workspace-1"))
	require.NoError(t, options.RoutePanelCommand("panel-1", "command"))
	require.NoError(t, options.RequestPanelObjectOpen("panel-1", objectRef, "details"))
	require.NoError(t, options.AuthorizePanelObjectOpen(
		"workspace-1",
		"panel-1",
		"tab-1",
		objectRef,
		"details",
	))
	require.NoError(t, options.UpdatePanelSnapshot("panel-1", snapshot))
	require.NoError(t, options.RequestPanelTabClose("panel-1", "tab-1"))
	require.NoError(t, options.AuthorizePanelTabClose("workspace-1", "panel-1", "tab-1"))
	require.NoError(t, options.RequestPanelTabTransfer("panel-1", panelwindow.TabTransferRequest{}))
	require.NoError(t, options.AcceptPanelTabTransfer("workspace-1", "tab-transfer-1"))
	require.NoError(t, options.FailPanelTabTransfer("panel-1", "tab-transfer-1"))
	require.NoError(t, options.RequestPanelGuard("workspace-1", "panel-1", "guard-1", "close"))
	require.NoError(t, options.AcknowledgePanelGuard("panel-1", "guard-1", true))
	require.NoError(t, options.AcknowledgeApplicationQuit("workspace-1", "quit-1", true))

	require.Equal(t, []string{
		"prepare-quit",
		"focus-most-recent",
		"create-workspace",
		"window-descriptor",
		"window-descriptor",
		"begin-open",
		"acknowledge-ready",
		"begin-dock",
		"acknowledge-dock",
		"fail-transfer",
		"focus-panel",
		"request-close",
		"acknowledge-close",
		"acknowledge-workspace-close",
		"route-command",
		"request-object-open",
		"authorize-object-open",
		"update-snapshot",
		"request-tab-close",
		"authorize-tab-close",
		"request-tab-transfer",
		"accept-tab-transfer",
		"fail-tab-transfer",
		"request-guard",
		"acknowledge-guard",
		"acknowledge-quit",
	}, registry.calls)
}

func TestNewSentryReporterStaysDisabledWhenBuildDisablesReporting(t *testing.T) {
	t.Setenv("SENTRY_BACKEND_DSN", "https://runtime@example.com/2")

	reporter, err := newSentryReporter(false, "https://embedded@example.com/1", "v1.2.3")

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestNewSentryReporterStartsDisabledUntilPersistedPreferenceLoads(t *testing.T) {
	reporter, err := newSentryReporter(true, "https://embedded@example.com/1", "v1.2.3")

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestApplicationCompositionOwnsPeerWindowRegistryMenuAndService(t *testing.T) {
	composition := sharedTestComposition()

	require.NotNil(t, composition.application)
	require.NotNil(t, composition.backend)
	require.NotNil(t, composition.service)
	require.NotNil(t, composition.operations)
	require.NotNil(t, composition.menu)
	require.Equal(t, composition.menu, composition.application.Menu.GetApplicationMenu())

	window, ok := composition.application.Window.GetByName("workspace-1")
	require.True(t, ok)
	require.NotNil(t, composition.windows)
	require.Equal(t, "workspace-1", window.Name())
	require.Equal(t, 1, composition.windows.Count())
	config := composition.application.Config()
	require.Len(t, config.Services, 1)
	require.NotNil(t, config.Assets.Handler)
	require.NotNil(t, config.ShouldQuit)
	require.NotNil(t, config.SingleInstance)
	require.Equal(t, testSingleInstanceID(), config.SingleInstance.UniqueID)
	require.NotNil(t, config.SingleInstance.OnSecondInstanceLaunch)
}

func TestSingleInstanceUniqueIDDefaultsToProductIdentifier(t *testing.T) {
	require.Equal(t, applicationProductIdentifier, singleInstanceUniqueID(""))
	require.Equal(t, applicationProductIdentifier, singleInstanceUniqueID(" \t"))
	require.Equal(t, "test-instance", singleInstanceUniqueID(" test-instance "))
}

type startupFailureProbeService struct {
	name               string
	startupErr         error
	context            context.Context
	shutdownContextErr error
	sequence           *[]string
}

func (s *startupFailureProbeService) ServiceName() string { return s.name }

func (s *startupFailureProbeService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.context = ctx
	*s.sequence = append(*s.sequence, "start:"+s.name)
	return s.startupErr
}

func (s *startupFailureProbeService) ServiceShutdown() error {
	s.shutdownContextErr = s.context.Err()
	*s.sequence = append(*s.sequence, "stop:"+s.name)
	return nil
}

func TestApplicationRunRollsBackStartedServicesAfterStartupFailure(t *testing.T) {
	const helperEnv = "LUXURY_YACHT_TEST_STARTUP_FAILURE"
	if os.Getenv(helperEnv) != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestApplicationRunRollsBackStartedServicesAfterStartupFailure$")
		command.Env = append(os.Environ(), helperEnv+"=1")
		output, err := command.CombinedOutput()
		require.NoError(t, err, string(output))
		return
	}

	sequence := []string{}
	started := &startupFailureProbeService{name: "started", sequence: &sequence}
	failure := errors.New("startup failed")
	failing := &startupFailureProbeService{name: "failing", startupErr: failure, sequence: &sequence}
	wailsApp := application.New(application.Options{ErrorHandler: func(error) {}})
	wailsApp.RegisterService(application.NewService(started))
	wailsApp.RegisterService(application.NewService(failing))

	err := wailsApp.Run()

	require.ErrorIs(t, err, failure)
	require.Equal(t, []string{"start:started", "start:failing", "stop:started"}, sequence)
	require.ErrorIs(t, started.shutdownContextErr, context.Canceled)
}
