package main

import (
	"embed"
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/appwindow"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatetemp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

const applicationProductIdentifier = updateidentity.ProductIdentifier

func reportPanic(reporter sentryreporting.Reporter) {
	if recovered := recover(); recovered != nil {
		reporter.CapturePanic(recovered, sentryreporting.Context{Source: "Process"})
		panic(recovered)
	}
}

func reportRunError(reporter sentryreporting.Reporter, err error) {
	if err != nil {
		reporter.CaptureException(err, sentryreporting.Context{Source: "Wails"})
	}
}

func defaultSentryRelease(version string) string {
	version = strings.TrimSpace(version)
	if version == "" || version == "dev" {
		return ""
	}
	return "luxury-yacht@" + version
}

func newSentryReporter(enabled bool, defaultDSN, version string) (sentryreporting.Reporter, error) {
	if !enabled {
		return sentryreporting.New(sentryreporting.Config{})
	}
	return sentryreporting.NewDisabled(sentryreporting.ConfigFromEnvironment(
		defaultDSN,
		defaultSentryRelease(version),
		"production",
	))
}

type applicationComposition struct {
	application *application.App
	backend     *backend.ApplicationRuntime
	service     *backend.DesktopService
	operations  *backend.OperationsCoordinator
	preferences *backend.PreferencesService
	reporting   *backend.ErrorReportingService
	windows     *appwindow.Registry
	menu        *application.Menu
}

type compositionOptions struct {
	SingleInstance         bool
	SingleInstanceUniqueID string
	UpdateTempRoot         string
	UpdateTempSetupError   error
}

type nativeWindowRegistry interface {
	PrepareApplicationQuit() bool
	FocusMostRecent()
	Create(bool) *application.WebviewWindow
	WindowDescriptor(string) (panelwindow.NativeDescriptor, error)
	BeginPanelWindowOpen(panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error)
	AcknowledgePanelWindowReady(string, string) (panelwindow.WindowDescriptor, error)
	BeginPanelWindowDock(string, string, panelwindow.GroupSnapshot) error
	AcknowledgePanelWindowDock(string, string, string) error
	FailPanelWindowTransfer(string, string, string) error
	FocusPanelWindow(string, string, string) error
	RequestPanelWindowClose(string, string, string) error
	AcknowledgePanelWindowClose(string) error
	AcknowledgeWorkspaceWindowClose(string) error
	RoutePanelWindowCommand(string, panelwindow.OwnerCommand) error
	RequestPanelObjectOpen(string, panelwindow.ObjectReference, string) error
	AuthorizePanelObjectOpen(string, string, string, panelwindow.ObjectReference, string) error
	UpdatePanelWindowSnapshot(string, panelwindow.GroupSnapshot) error
	RequestPanelTabClose(string, string) error
	AuthorizePanelTabClose(string, string, string) error
	RequestPanelTabTransfer(string, panelwindow.TabTransferRequest) error
	AcceptPanelTabTransfer(string, string) error
	FailPanelTabTransfer(string, string) error
	RequestPanelWindowGuard(string, string, string, string) error
	AcknowledgePanelWindowGuard(string, string, bool) error
	AcknowledgeApplicationQuitPreflight(string, string, bool) error
}

// windowRegistryBridge breaks the startup cycle between backend composition
// and the native-window registry. It is bound once after both sides exist.
type windowRegistryBridge struct {
	registry nativeWindowRegistry
}

func (bridge *windowRegistryBridge) bind(registry nativeWindowRegistry) {
	bridge.registry = registry
}

func (bridge *windowRegistryBridge) registryOrError() (nativeWindowRegistry, error) {
	if bridge.registry == nil {
		return nil, fmt.Errorf("native window registry is not available")
	}
	return bridge.registry, nil
}

func (bridge *windowRegistryBridge) prepareApplicationQuit() bool {
	if bridge.registry == nil {
		return true
	}
	return bridge.registry.PrepareApplicationQuit()
}

func (bridge *windowRegistryBridge) onSecondInstanceLaunch(application.SecondInstanceData) {
	if bridge.registry != nil {
		bridge.registry.FocusMostRecent()
	}
}

func (bridge *windowRegistryBridge) createWorkspaceWindow() {
	if bridge.registry != nil {
		bridge.registry.Create(false)
	}
}

func (bridge *windowRegistryBridge) isWorkspaceWindow(windowName string) bool {
	if bridge.registry == nil {
		return false
	}
	descriptor, err := bridge.registry.WindowDescriptor(windowName)
	return err == nil && descriptor.Role == panelwindow.NativeRoleWorkspace
}

func (bridge *windowRegistryBridge) nativeWindowDescriptor(
	windowName string,
) (panelwindow.NativeDescriptor, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.NativeDescriptor{}, err
	}
	return registry.WindowDescriptor(windowName)
}

func (bridge *windowRegistryBridge) beginPanelWindowOpen(
	snapshot panelwindow.GroupSnapshot,
) (panelwindow.WindowDescriptor, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.WindowDescriptor{}, err
	}
	return registry.BeginPanelWindowOpen(snapshot)
}

func (bridge *windowRegistryBridge) acknowledgePanelReady(
	windowName, transferID string,
) (panelwindow.WindowDescriptor, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.WindowDescriptor{}, err
	}
	return registry.AcknowledgePanelWindowReady(windowName, transferID)
}

func (bridge *windowRegistryBridge) beginPanelWindowDock(
	windowName, targetPosition string,
	snapshot panelwindow.GroupSnapshot,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.BeginPanelWindowDock(windowName, targetPosition, snapshot)
}

func (bridge *windowRegistryBridge) acknowledgePanelDock(
	ownerWindowName, windowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWindowDock(ownerWindowName, windowName, transferID)
}

func (bridge *windowRegistryBridge) failPanelTransfer(
	callerWindowName, windowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FailPanelWindowTransfer(callerWindowName, windowName, transferID)
}

func (bridge *windowRegistryBridge) focusPanelWindow(
	ownerWindowName, windowName, panelID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FocusPanelWindow(ownerWindowName, windowName, panelID)
}

func (bridge *windowRegistryBridge) requestPanelClose(
	callerWindowName, windowName, reason string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelWindowClose(callerWindowName, windowName, reason)
}

func (bridge *windowRegistryBridge) acknowledgePanelClose(windowName string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWindowClose(windowName)
}

func (bridge *windowRegistryBridge) acknowledgeWorkspaceClose(ownerWindowName string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeWorkspaceWindowClose(ownerWindowName)
}

func (bridge *windowRegistryBridge) routePanelCommand(windowName string, command panelwindow.OwnerCommand) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RoutePanelWindowCommand(windowName, command)
}

func (bridge *windowRegistryBridge) requestPanelObjectOpen(
	windowName string,
	ref panelwindow.ObjectReference,
	activeView string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelObjectOpen(windowName, ref, activeView)
}

func (bridge *windowRegistryBridge) authorizePanelObjectOpen(
	ownerWindowName, windowName, panelID string,
	ref panelwindow.ObjectReference,
	activeView string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AuthorizePanelObjectOpen(
		ownerWindowName,
		windowName,
		panelID,
		ref,
		activeView,
	)
}

func (bridge *windowRegistryBridge) updatePanelSnapshot(
	windowName string,
	snapshot panelwindow.GroupSnapshot,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.UpdatePanelWindowSnapshot(windowName, snapshot)
}

func (bridge *windowRegistryBridge) requestPanelTabClose(windowName, panelID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelTabClose(windowName, panelID)
}

func (bridge *windowRegistryBridge) authorizePanelTabClose(
	ownerWindowName, windowName, panelID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AuthorizePanelTabClose(ownerWindowName, windowName, panelID)
}

func (bridge *windowRegistryBridge) requestPanelTabTransfer(
	callerWindowName string,
	request panelwindow.TabTransferRequest,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelTabTransfer(callerWindowName, request)
}

func (bridge *windowRegistryBridge) acceptPanelTabTransfer(
	ownerWindowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcceptPanelTabTransfer(ownerWindowName, transferID)
}

func (bridge *windowRegistryBridge) failPanelTabTransfer(
	callerWindowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FailPanelTabTransfer(callerWindowName, transferID)
}

func (bridge *windowRegistryBridge) requestPanelGuard(
	ownerWindowName, windowName, requestID, reason string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelWindowGuard(ownerWindowName, windowName, requestID, reason)
}

func (bridge *windowRegistryBridge) acknowledgePanelGuard(
	windowName, requestID string,
	allowed bool,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWindowGuard(windowName, requestID, allowed)
}

func (bridge *windowRegistryBridge) acknowledgeApplicationQuit(
	ownerWindowName, transactionID string,
	allowed bool,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeApplicationQuitPreflight(ownerWindowName, transactionID, allowed)
}

func (bridge *windowRegistryBridge) runtimeOptions(
	reporter sentryreporting.Reporter,
	updates backend.ApplicationUpdateOptions,
) backend.ApplicationRuntimeOptions {
	return backend.ApplicationRuntimeOptions{
		Reporter:                   reporter,
		ApplicationUpdates:         updates,
		CreateWorkspaceWindow:      bridge.createWorkspaceWindow,
		IsWorkspaceWindow:          bridge.isWorkspaceWindow,
		NativeWindowDescriptor:     bridge.nativeWindowDescriptor,
		BeginPanelWindowOpen:       bridge.beginPanelWindowOpen,
		AcknowledgePanelReady:      bridge.acknowledgePanelReady,
		BeginPanelWindowDock:       bridge.beginPanelWindowDock,
		AcknowledgePanelDock:       bridge.acknowledgePanelDock,
		FailPanelTransfer:          bridge.failPanelTransfer,
		FocusPanelWindow:           bridge.focusPanelWindow,
		RequestPanelClose:          bridge.requestPanelClose,
		AcknowledgePanelClose:      bridge.acknowledgePanelClose,
		AcknowledgeWorkspaceClose:  bridge.acknowledgeWorkspaceClose,
		RoutePanelCommand:          bridge.routePanelCommand,
		RequestPanelObjectOpen:     bridge.requestPanelObjectOpen,
		AuthorizePanelObjectOpen:   bridge.authorizePanelObjectOpen,
		UpdatePanelSnapshot:        bridge.updatePanelSnapshot,
		RequestPanelTabClose:       bridge.requestPanelTabClose,
		AuthorizePanelTabClose:     bridge.authorizePanelTabClose,
		RequestPanelTabTransfer:    bridge.requestPanelTabTransfer,
		AcceptPanelTabTransfer:     bridge.acceptPanelTabTransfer,
		FailPanelTabTransfer:       bridge.failPanelTabTransfer,
		RequestPanelGuard:          bridge.requestPanelGuard,
		AcknowledgePanelGuard:      bridge.acknowledgePanelGuard,
		AcknowledgeApplicationQuit: bridge.acknowledgeApplicationQuit,
	}
}

func singleInstanceUniqueID(configured string) string {
	if uniqueID := strings.TrimSpace(configured); uniqueID != "" {
		return uniqueID
	}
	return applicationProductIdentifier
}

func installNativeApplicationMenuForPlatform(goos string, install func()) {
	if goos == "darwin" && install != nil {
		install()
	}
}

func newApplicationComposition(reporter sentryreporting.Reporter, options compositionOptions) *applicationComposition {
	var backendRuntime *backend.ApplicationRuntime
	var desktopService *backend.DesktopService
	var windows *appwindow.Registry
	windowBridge := &windowRegistryBridge{}
	applicationOptions := application.Options{
		Name:        "Luxury Yacht",
		Description: "Sail the seas of Kubernetes in style",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		ShouldQuit: windowBridge.prepareApplicationQuit,
		ErrorHandler: func(err error) {
			reportRunError(reporter, err)
		},
	}
	if options.SingleInstance {
		applicationOptions.SingleInstance = &application.SingleInstanceOptions{
			UniqueID:               singleInstanceUniqueID(options.SingleInstanceUniqueID),
			ExitCode:               0,
			OnSecondInstanceLaunch: windowBridge.onSecondInstanceLaunch,
		}
	}
	wailsApp := application.New(applicationOptions)

	backendRuntime = backend.NewApplicationRuntime(wailsApp, windowBridge.runtimeOptions(
		reporter,
		backend.ApplicationUpdateOptions{
			TempRoot:       options.UpdateTempRoot,
			TempSetupError: options.UpdateTempSetupError,
		},
	))
	operationsCoordinator := backendRuntime.Operations
	desktopShell := backendRuntime.DesktopShell
	desktopService = backend.NewDesktopService(backend.DesktopServiceDependencies{
		Favorites:      backendRuntime.Favorites,
		UIState:        backendRuntime.UIState,
		Preferences:    backendRuntime.Preferences,
		DataManagement: backendRuntime.DataManagement,
		Attention:      backendRuntime.Attention,
		Workspace:      backendRuntime.Workspace,
		ClusterRuntime: backendRuntime.ClusterRuntime,
		Resources:      backendRuntime.Resources,
		Operations:     operationsCoordinator,
		Updates:        backendRuntime.Updates,
		Logs:           backendRuntime.AppLogs,
		DesktopShell:   desktopShell,
		PanelWindows:   desktopShell,
		Lifecycle:      backendRuntime.Lifecycle,
		HTTP:           backendRuntime.Refresh,
	})
	wailsApp.HandleStream(backend.RefreshResourceStreamName, backendRuntime.Refresh.HandleResourceStream)
	wailsApp.HandleStream(backend.RefreshContainerLogsStreamName, backendRuntime.Refresh.HandleContainerLogsStream)
	wailsApp.RegisterService(application.NewServiceWithOptions(
		desktopService,
		application.ServiceOptions{Route: "/api/v2"},
	))

	nativeMenu := backend.CreateMenu(desktopShell)
	installNativeApplicationMenuForPlatform(runtime.GOOS, func() {
		wailsApp.Menu.SetApplicationMenu(nativeMenu)
	})

	windows = appwindow.NewRegistry(wailsApp, backendRuntime.Lifecycle, nativeMenu)
	windowBridge.bind(windows)
	windows.Create(true)

	return &applicationComposition{
		application: wailsApp,
		backend:     backendRuntime,
		service:     desktopService,
		operations:  operationsCoordinator,
		preferences: backendRuntime.Preferences,
		reporting:   backendRuntime.ErrorReporting,
		windows:     windows,
		menu:        nativeMenu,
	}
}

func main() {
	updateTempRoot, updateTempSetupError := updatetemp.ConfigureProcess()
	if updateTempSetupError != nil {
		println("Automatic update temp setup disabled:", updateTempSetupError.Error())
	}
	backend.MaybeRunExecWrapper()

	reporter, reporterErr := newSentryReporter(
		sentryreporting.BuildEnabled(),
		backend.SentryDSN,
		backend.Version,
	)
	if reporterErr != nil {
		println("Sentry error reporting disabled:", reporterErr.Error())
		reporter, _ = sentryreporting.New(sentryreporting.Config{})
	}
	defer func() { reporter.Shutdown(2 * time.Second) }()
	defer reportPanic(reporter)

	composition := newApplicationComposition(reporter, compositionOptions{
		SingleInstance:       true,
		UpdateTempRoot:       updateTempRoot,
		UpdateTempSetupError: updateTempSetupError,
	})
	if err := backend.InitializeErrorReporting(composition.preferences, composition.reporting); err != nil {
		println("Sentry error reporting remains disabled:", err.Error())
	}
	if err := composition.application.Run(); err != nil {
		reportRunError(reporter, err)
		println("Error:", err.Error())
	}
}
