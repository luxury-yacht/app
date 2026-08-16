package main

import (
	"embed"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/appwindow"
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
	backend     *backend.App
	service     *backend.DesktopService
	operations  *backend.OperationsCoordinator
	preferences *backend.PreferencesService
	reporting   *backend.ErrorReportingService
	windows     *appwindow.Registry
	menu        *application.Menu
}

type compositionOptions struct {
	SingleInstance       bool
	UpdateTempRoot       string
	UpdateTempSetupError error
}

func newApplicationComposition(reporter sentryreporting.Reporter, options compositionOptions) *applicationComposition {
	var backendApp *backend.App
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
			UniqueID: applicationProductIdentifier,
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

	backendApp = backend.NewApp(wailsApp, reporter)
	operationsCoordinator := backendApp.OperationsCoordinator()
	desktopShell := backendApp.DesktopShell()
	backend.ConfigureApplicationUpdates(backendApp.UpdateCoordinator(), backend.ApplicationUpdateOptions{
		TempRoot:       options.UpdateTempRoot,
		TempSetupError: options.UpdateTempSetupError,
	})
	desktopService = backend.NewDesktopService(backend.DesktopServiceDependencies{
		Favorites:      backendApp.FavoritesService(),
		UIState:        backendApp.UIStateStore(),
		Preferences:    backendApp.PreferencesService(),
		DataManagement: backendApp.DataManagementCoordinator(),
		Attention:      backendApp.ClusterAttentionService(),
		Workspace:      backendApp,
		ClusterRuntime: backendApp,
		Resources:      backendApp,
		Operations:     operationsCoordinator,
		Updates:        backendApp.UpdateCoordinator(),
		Logs:           backendApp.AppLogService(),
		DesktopShell:   desktopShell,
		Lifecycle:      backendApp,
		HTTP:           backendApp,
	})
	wailsApp.HandleStream(backend.RefreshResourceStreamName, backendApp.HandleResourceStream)
	wailsApp.HandleStream(backend.RefreshContainerLogsStreamName, backendApp.HandleContainerLogsStream)
	wailsApp.RegisterService(application.NewServiceWithOptions(
		desktopService,
		application.ServiceOptions{Route: "/api/v2"},
	))

	nativeMenu := backend.CreateMenu(desktopShell)
	wailsApp.Menu.SetApplicationMenu(nativeMenu)

	windows = appwindow.NewRegistry(wailsApp, backendApp, nativeMenu)
	backend.ConfigureWorkspaceWindowCreator(desktopShell, func() { windows.Create(false) })
	windows.Create(true)

	return &applicationComposition{
		application: wailsApp,
		backend:     backendApp,
		service:     desktopService,
		operations:  operationsCoordinator,
		preferences: backendApp.PreferencesService(),
		reporting:   backendApp.ErrorReportingService(),
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
