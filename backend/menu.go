package backend

import (
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// CreateMenu creates the application menu with OS-specific adjustments
func CreateMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()

	// Application/File menu (different per OS)
	createApplicationMenu(appMenu, app)

	// Edit menu (for standard editing shortcuts)
	createEditMenu(appMenu, app)

	// View menu
	createViewMenu(appMenu, app)

	// Window menu
	createWindowMenu(appMenu, app)

	return appMenu
}

// createApplicationMenu creates the main application menu (or File menu on Windows/Linux)
func createApplicationMenu(appMenu *menu.Menu, app *App) {
	var fileMenu *menu.Menu

	switch runtime.GOOS {
	case "darwin":
		// macOS: Use app name "Luxury Yacht" for the application menu
		fileMenu = appMenu.AddSubmenu("Luxury Yacht")

		fileMenu.AddText("About Luxury Yacht", nil, func(_ *menu.CallbackData) {
			go func() {
				app.ShowAbout()
			}()
		})

		fileMenu.AddSeparator()

		fileMenu.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
			go func() {
				app.ShowSettings()
			}()
		})

		fileMenu.AddText("Hide Luxury Yacht", keys.CmdOrCtrl("h"), func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.Hide(app.Ctx)
				}
			}()
		})

		fileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			if app.Ctx != nil {
				wailsRuntime.Quit(app.Ctx)
			}
		})

	case "windows":
		// Windows: Use "File" menu
		fileMenu = appMenu.AddSubmenu("File")

		fileMenu.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
			go func() {
				app.ShowSettings()
			}()
		})

		fileMenu.AddSeparator()

		fileMenu.AddText("Exit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			if app.Ctx != nil {
				wailsRuntime.Quit(app.Ctx)
			}
		})

		// Help menu for About/License on Windows
		helpMenu := appMenu.AddSubmenu("Help")

		helpMenu.AddText("About Luxury Yacht", nil, func(_ *menu.CallbackData) {
			go func() {
				app.ShowAbout()
			}()
		})

	default: // linux and other unix-like systems
		// Linux: Similar to Windows
		fileMenu = appMenu.AddSubmenu("File")

		fileMenu.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
			go func() {
				app.ShowSettings()
			}()
		})

		fileMenu.AddSeparator()

		fileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			if app.Ctx != nil {
				wailsRuntime.Quit(app.Ctx)
			}
		})

		// Help menu for About/License on Linux
		helpMenu := appMenu.AddSubmenu("Help")

		helpMenu.AddText("About Luxury Yacht", nil, func(_ *menu.CallbackData) {
			go func() {
				app.ShowAbout()
			}()
		})

	}
}

// createEditMenu creates the Edit menu with standard editing commands
func createEditMenu(appMenu *menu.Menu, app *App) {
	editMenu := appMenu.AddSubmenu("Edit")

	// Copy
	editMenu.AddText("Copy", keys.CmdOrCtrl("c"), func(_ *menu.CallbackData) {
		// This will be handled by the frontend
		if app.Ctx != nil {
			app.emitEvent("menu:copy")
		}
	})

	// Select All
	editMenu.AddText("Select All", keys.CmdOrCtrl("a"), func(_ *menu.CallbackData) {
		// This will be handled by the frontend
		if app.Ctx != nil {
			app.emitEvent("menu:selectAll")
		}
	})
}

// createViewMenu creates the View menu with consistent items across platforms
func createViewMenu(appMenu *menu.Menu, app *App) {
	viewMenu := appMenu.AddSubmenu("View")

	// Zoom controls
	viewMenu.AddText("Zoom In", keys.CmdOrCtrl("+"), func(_ *menu.CallbackData) {
		go func() {
			app.emitEvent("zoom-in")
		}()
	})

	viewMenu.AddText("Zoom Out", keys.CmdOrCtrl("-"), func(_ *menu.CallbackData) {
		go func() {
			app.emitEvent("zoom-out")
		}()
	})

	viewMenu.AddText("Reset Zoom", keys.CmdOrCtrl("0"), func(_ *menu.CallbackData) {
		go func() {
			app.emitEvent("zoom-reset")
		}()
	})

	viewMenu.AddSeparator()

	// Dynamic sidebar menu item text
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}

	viewMenu.AddText(sidebarText, keys.Key("b"), func(_ *menu.CallbackData) {
		go func() {
			if err := app.ToggleSidebar(); err != nil {
				println("Failed to toggle sidebar:", err.Error())
			}
		}()
	})

	viewMenu.AddText("Diff Objects", keys.CmdOrCtrl("d"), func(_ *menu.CallbackData) {
		go func() {
			if err := app.ToggleObjectDiff(); err != nil {
				println("Failed to toggle object diff:", err.Error())
			}
		}()
	})

	// Dynamic logs panel menu item text
	logsText := "Show Application Logs"
	if app.IsLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}

	viewMenu.AddText(logsText, keys.Combo("l", keys.ShiftKey, keys.ControlKey), func(_ *menu.CallbackData) {
		go func() {
			if err := app.ToggleLogsPanel(); err != nil {
				println("Failed to toggle logs panel:", err.Error())
			}
		}()
	})

	// Dynamic Diagnostics panel menu item text
	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}

	viewMenu.AddText(diagnosticsText, keys.Combo("d", keys.ShiftKey, keys.ControlKey), func(_ *menu.CallbackData) {
		go func() {
			if err := app.ToggleDiagnosticsPanel(); err != nil {
				println("Failed to toggle diagnostics panel:", err.Error())
			}
		}()
	})

	// Dynamic Port Forwards panel menu item text
	portForwardsText := "Show Port Forwards Panel"
	if app.IsPortForwardsPanelVisible() {
		portForwardsText = "Hide Port Forwards Panel"
	}

	viewMenu.AddText(portForwardsText, keys.Combo("f", keys.ShiftKey, keys.CmdOrCtrlKey), func(_ *menu.CallbackData) {
		go func() {
			if err := app.TogglePortForwardsPanel(); err != nil {
				println("Failed to toggle port forwards panel:", err.Error())
			}
		}()
	})

	// macOS will automatically add "Enter Full Screen" after this separator
	if runtime.GOOS == "darwin" {
		viewMenu.AddSeparator()
	}
}

// createWindowMenu creates the Window menu with OS-specific items
func createWindowMenu(appMenu *menu.Menu, app *App) {
	windowMenu := appMenu.AddSubmenu("Window")

	// Minimize is common to all platforms
	windowMenu.AddText("Minimize", keys.CmdOrCtrl("m"), func(_ *menu.CallbackData) {
		go func() {
			if app.Ctx != nil {
				wailsRuntime.WindowMinimise(app.Ctx)
			}
		}()
	})

	switch runtime.GOOS {
	case "darwin":
		// macOS specific Window menu items
		windowMenu.AddText("Zoom", nil, func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowToggleMaximise(app.Ctx)
				}
			}()
		})

		windowMenu.AddSeparator()

		windowMenu.AddText("Bring All to Front", nil, func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowShow(app.Ctx)
					wailsRuntime.WindowSetAlwaysOnTop(app.Ctx, true)
					wailsRuntime.WindowSetAlwaysOnTop(app.Ctx, false)
				}
			}()
		})

		// Separator for macOS to insert "Enter Full Screen" and window list
		windowMenu.AddSeparator()

	case "windows":
		// Windows specific Window menu items
		windowMenu.AddText("Maximize", nil, func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowMaximise(app.Ctx)
				}
			}()
		})

		windowMenu.AddText("Restore", nil, func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowUnmaximise(app.Ctx)
				}
			}()
		})

		windowMenu.AddSeparator()

		windowMenu.AddText("Close", keys.CmdOrCtrl("w"), func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowHide(app.Ctx)
				}
			}()
		})

	default: // linux and other unix-like systems
		// Linux specific Window menu items
		windowMenu.AddText("Maximize", nil, func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowToggleMaximise(app.Ctx)
				}
			}()
		})

		windowMenu.AddSeparator()

		windowMenu.AddText("Close", keys.CmdOrCtrl("w"), func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowHide(app.Ctx)
				}
			}()
		})
	}
}
