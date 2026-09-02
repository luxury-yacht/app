package main

import (
	"embed"
	"fmt"
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

func singleInstanceUniqueID(configured string) string {
	if uniqueID := strings.TrimSpace(configured); uniqueID != "" {
		return uniqueID
	}
	return applicationProductIdentifier
}

func newApplicationComposition(reporter sentryreporting.Reporter, options compositionOptions) *applicationComposition {
	var backendRuntime *backend.ApplicationRuntime
	var desktopService *backend.DesktopService
	var windows *appwindow.Registry
	applicationOptions := application.Options{
		Name:        "Luxury Yacht",
		Description: "Sail the seas of Kubernetes in style",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		ShouldQuit: func() bool {
			return windows == nil || windows.PrepareApplicationQuit()
		},
		ErrorHandler: func(err error) {
			reportRunError(reporter, err)
		},
	}
	if options.SingleInstance {
		applicationOptions.SingleInstance = &application.SingleInstanceOptions{
			UniqueID: singleInstanceUniqueID(options.SingleInstanceUniqueID),
			ExitCode: 0,
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if windows == nil {
					return
				}
				windows.FocusMostRecent()
			},
		}
	}
	wailsApp := application.New(applicationOptions)

	backendRuntime = backend.NewApplicationRuntime(wailsApp, backend.ApplicationRuntimeOptions{
		Reporter: reporter,
		ApplicationUpdates: backend.ApplicationUpdateOptions{
			TempRoot:       options.UpdateTempRoot,
			TempSetupError: options.UpdateTempSetupError,
		},
		CreateWorkspaceWindow: func() {
			if windows != nil {
				windows.Create(false)
			}
		},
		IsWorkspaceWindow: func(windowName string) bool {
			if windows == nil {
				return false
			}
			descriptor, err := windows.WindowDescriptor(windowName)
			return err == nil && descriptor.Role == panelwindow.NativeRoleWorkspace
		},
		NativeWindowDescriptor: func(windowName string) (panelwindow.NativeDescriptor, error) {
			if windows == nil {
				return panelwindow.NativeDescriptor{}, fmt.Errorf("native window registry is not available")
			}
			return windows.WindowDescriptor(windowName)
		},
		BeginPanelWindowOpen: func(snapshot panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error) {
			if windows == nil {
				return panelwindow.WindowDescriptor{}, fmt.Errorf("native window registry is not available")
			}
			return windows.BeginPanelWindowOpen(snapshot)
		},
		AcknowledgePanelReady: func(windowName, transferID string) (panelwindow.WindowDescriptor, error) {
			if windows == nil {
				return panelwindow.WindowDescriptor{}, fmt.Errorf("native window registry is not available")
			}
			return windows.AcknowledgePanelWindowReady(windowName, transferID)
		},
		BeginPanelWindowDock: func(windowName, targetPosition string, snapshot panelwindow.GroupSnapshot) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.BeginPanelWindowDock(windowName, targetPosition, snapshot)
		},
		AcknowledgePanelDock: func(ownerWindowName, windowName, transferID string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AcknowledgePanelWindowDock(ownerWindowName, windowName, transferID)
		},
		FailPanelTransfer: func(callerWindowName, windowName, transferID string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.FailPanelWindowTransfer(callerWindowName, windowName, transferID)
		},
		FocusPanelWindow: func(ownerWindowName, windowName, panelID string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.FocusPanelWindow(ownerWindowName, windowName, panelID)
		},
		RequestPanelClose: func(callerWindowName, windowName, reason string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.RequestPanelWindowClose(callerWindowName, windowName, reason)
		},
		AcknowledgePanelClose: func(windowName string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AcknowledgePanelWindowClose(windowName)
		},
		AcknowledgeWorkspaceClose: func(ownerWindowName string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AcknowledgeWorkspaceWindowClose(ownerWindowName)
		},
		RoutePanelCommand: func(windowName, eventName string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.RoutePanelWindowCommand(windowName, eventName)
		},
		RequestPanelObjectOpen: func(windowName string, ref panelwindow.ObjectReference, activeView string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.RequestPanelObjectOpen(windowName, ref, activeView)
		},
		AuthorizePanelObjectOpen: func(ownerWindowName, windowName, panelID string, ref panelwindow.ObjectReference, activeView string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AuthorizePanelObjectOpen(ownerWindowName, windowName, panelID, ref, activeView)
		},
		UpdatePanelSnapshot: func(windowName string, snapshot panelwindow.GroupSnapshot) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.UpdatePanelWindowSnapshot(windowName, snapshot)
		},
		RequestPanelTabClose: func(windowName, panelID string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.RequestPanelTabClose(windowName, panelID)
		},
		AuthorizePanelTabClose: func(ownerWindowName, windowName, panelID string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AuthorizePanelTabClose(ownerWindowName, windowName, panelID)
		},
		RequestPanelGuard: func(ownerWindowName, windowName, requestID, reason string) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.RequestPanelWindowGuard(ownerWindowName, windowName, requestID, reason)
		},
		AcknowledgePanelGuard: func(windowName, requestID string, allowed bool) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AcknowledgePanelWindowGuard(windowName, requestID, allowed)
		},
		AcknowledgeApplicationQuit: func(ownerWindowName, transactionID string, allowed bool) error {
			if windows == nil {
				return fmt.Errorf("native window registry is not available")
			}
			return windows.AcknowledgeApplicationQuitPreflight(ownerWindowName, transactionID, allowed)
		},
	})
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
	wailsApp.Menu.SetApplicationMenu(nativeMenu)

	windows = appwindow.NewRegistry(wailsApp, backendRuntime.Lifecycle, nativeMenu)
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
