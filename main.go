package main

import (
	"context"
	"embed"
	"os"
	goruntime "runtime"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/backend/sigstack"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed frontend/dist
var assets embed.FS

// main function initializes and runs the Wails application
func main() {
	// Exit early when running as the exec helper wrapper.
	backend.MaybeRunExecWrapper()

	// Create an instance of the app structure
	app := backend.NewApp()

	// Store the initial menu
	appMenu := backend.CreateMenu(app)

	// Custom startup that sets up menu updates
	onStartup := func(ctx context.Context) {
		app.Startup(ctx)

		if goruntime.GOOS == "linux" {
			// WebKitGTK installs a SIGSEGV handler without SA_ONSTACK on some distros
			// (Ubuntu 24.04 / WebKit 2.48) which triggers Go's fatal signal check.
			// Reapply SA_ONSTACK to keep Go happy.
			sigstack.StartPatchLoop()
		}

		// Listen for menu update events
		runtime.EventsOn(ctx, "update-menu", func(optionalData ...any) {
			// Recreate and set the menu with updated state
			newMenu := backend.CreateMenu(app)
			runtime.MenuSetApplicationMenu(ctx, newMenu)
		})
	}

	// Create application with options
	startHidden := true
	frameless := false
	maxWidth := 0
	maxHeight := 0
	if goruntime.GOOS == "linux" {
		// Some Linux window managers ignore Show when StartHidden is true.
		startHidden = false
		// Wails v2.11.0 on Wayland incorrectly constrains the window when
		// MaxWidth/MaxHeight are 0 (the default), because the compositor
		// includes decoration sizes in the reported dimensions. Setting
		// explicit large values works around the issue until the upstream
		// fix (PR #4047) ships in a tagged release.
		if os.Getenv("XDG_SESSION_TYPE") == "wayland" {
			maxWidth = 15360
			maxHeight = 8640
		}
	}

	err := wails.Run(&options.App{
		Title:     "Luxury Yacht",
		Height:    800,
		Width:     1200,
		MinHeight: 600,
		MinWidth:  1100,
		MaxHeight: maxHeight,
		MaxWidth:  maxWidth,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 30, G: 30, B: 30, A: 255},
		OnStartup:        onStartup,
		OnBeforeClose:    backend.NewBeforeCloseHandler(app),
		OnShutdown:       app.Shutdown,
		Menu:             appMenu,
		Bind: []any{
			app,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				FullSizeContent:            true,
				HideTitle:                  true,
				UseToolbar:                 false,
				HideToolbarSeparator:       true,
			},
			WebviewIsTransparent: true,
		},
		StartHidden:     startHidden,
		Frameless:       frameless,
		CSSDragProperty: "--wails-draggable",
		CSSDragValue:    "true",

		// Open dev tools automatically in development
		// OnDomReady: func(ctx context.Context) {
		// 	runtime.WindowExecJS(ctx, "console.log('[Wails] Opening dev tools automatically');")
		// },
		// Debug: options.Debug{
		// 	OpenInspectorOnStartup: true, // This opens dev tools automatically
		// },
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
