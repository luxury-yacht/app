package bootstrap

import (
	"io/fs"
	"runtime"
	"strings"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/appwindow"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const applicationProductIdentifier = updateidentity.ProductIdentifier

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

func windowRuntimeOptions(
	bridge *appwindow.Bridge,
	reporter sentryreporting.Reporter,
	updates backend.ApplicationUpdateOptions,
) backend.ApplicationRuntimeOptions {
	return backend.ApplicationRuntimeOptions{
		PanelWorkspace:             bridge,
		Reporter:                   reporter,
		ApplicationUpdates:         updates,
		CreateWorkspaceWindow:      bridge.CreateWorkspaceWindow,
		IsWorkspaceWindow:          bridge.IsWorkspaceWindow,
		NativeWindowDescriptor:     bridge.NativeWindowDescriptor,
		BeginPanelWindowOpen:       bridge.BeginPanelWindowOpen,
		AcknowledgePanelReady:      bridge.AcknowledgePanelReady,
		BeginPanelWindowDock:       bridge.BeginPanelWindowDock,
		AcknowledgePanelDock:       bridge.AcknowledgePanelDock,
		FailPanelTransfer:          bridge.FailPanelTransfer,
		AcknowledgePanelClose:      bridge.AcknowledgePanelClose,
		AcknowledgeWorkspaceClose:  bridge.AcknowledgeWorkspaceClose,
		RoutePanelCommand:          bridge.RoutePanelCommand,
		UpdatePanelSnapshot:        bridge.UpdatePanelSnapshot,
		RequestPanelTabClose:       bridge.RequestPanelTabClose,
		RequestPanelTabTransfer:    bridge.RequestPanelTabTransfer,
		AcceptPanelTabTransfer:     bridge.AcceptPanelTabTransfer,
		FailPanelTabTransfer:       bridge.FailPanelTabTransfer,
		AcknowledgeApplicationQuit: bridge.AcknowledgeApplicationQuit,
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

func newApplicationComposition(assets fs.FS, reporter sentryreporting.Reporter, options compositionOptions) *applicationComposition {
	var backendRuntime *backend.ApplicationRuntime
	var desktopService *backend.DesktopService
	var windows *appwindow.Registry
	windowBridge := &appwindow.Bridge{}
	applicationOptions := application.Options{
		Name:        "Luxury Yacht",
		Description: "Sail the seas of Kubernetes in style",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		ShouldQuit: windowBridge.PrepareApplicationQuit,
		ErrorHandler: func(err error) {
			sentryreporting.ReportRunError(reporter, err)
		},
	}
	if options.SingleInstance {
		applicationOptions.SingleInstance = &application.SingleInstanceOptions{
			UniqueID:               singleInstanceUniqueID(options.SingleInstanceUniqueID),
			ExitCode:               0,
			OnSecondInstanceLaunch: windowBridge.OnSecondInstanceLaunch,
		}
	}
	wailsApp := application.New(applicationOptions)

	backendRuntime = backend.NewApplicationRuntime(wailsApp, windowRuntimeOptions(windowBridge,
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

	windows = appwindow.NewRegistry(wailsApp, backendRuntime.Lifecycle)
	windowBridge.Bind(windows)
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
