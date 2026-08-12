package main

import (
	"embed"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

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
	desktop     *desktopAdapter
	window      *application.WebviewWindow
	menu        *application.Menu
}

type compositionOptions struct {
	SingleInstance bool
}

func newApplicationComposition(reporter sentryreporting.Reporter, options compositionOptions) *applicationComposition {
	var backendApp *backend.App
	secondLaunch := newSecondLaunchCoordinator(application.InvokeAsync)
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
			return backendApp == nil || backendApp.PrepareQuit()
		},
		ErrorHandler: func(err error) {
			reportRunError(reporter, err)
		},
		OnShutdown: secondLaunch.Stop,
	}
	if options.SingleInstance {
		applicationOptions.SingleInstance = newSingleInstanceOptions(secondLaunch)
	}
	wailsApp := application.New(applicationOptions)

	desktop := newDesktopAdapter(wailsApp, mainWindowName)
	backendApp = backend.NewApp(desktop, reporter)
	wailsApp.RegisterService(application.NewService(backendApp))

	nativeMenu := desktop.initialiseMenu(func() *backend.MenuModel {
		return backend.CreateMenu(backendApp)
	})

	startHidden := true
	if runtime.GOOS == "linux" {
		startHidden = false
	}
	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             mainWindowName,
		Title:            "Luxury Yacht",
		Width:            1200,
		Height:           800,
		MinWidth:         1100,
		MinHeight:        600,
		Hidden:           startHidden,
		URL:              "/",
		BackgroundColour: application.NewRGB(30, 30, 30),
		BackgroundType:   application.BackgroundTypeTransparent,
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBar{
				AppearsTransparent:   true,
				FullSizeContent:      true,
				HideTitle:            true,
				HideToolbarSeparator: true,
			},
		},
		Windows: application.WindowsWindow{
			Theme: application.SystemDefault,
		},
		Linux: application.LinuxWindow{
			Menu: nativeMenu,
		},
		UseApplicationMenu: true,
		Zoom:               1,
		ZoomControlEnabled: false,
	})

	mainWindow.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		backendApp.WindowRuntimeReady()
		secondLaunch.Bind(func() {
			_ = desktop.BringMainWindowToFront()
		})
	})
	mainWindow.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !backendApp.PrepareQuit() {
			event.Cancel()
		}
	})

	return &applicationComposition{
		application: wailsApp,
		backend:     backendApp,
		desktop:     desktop,
		window:      mainWindow,
		menu:        nativeMenu,
	}
}

func main() {
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

	composition := newApplicationComposition(reporter, compositionOptions{SingleInstance: true})
	if err := backend.InitializeErrorReporting(composition.backend); err != nil {
		println("Sentry error reporting remains disabled:", err.Error())
	}
	if err := composition.application.Run(); err != nil {
		reportRunError(reporter, err)
		println("Error:", err.Error())
	}
}
