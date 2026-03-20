package backend

import (
	"os"
	"os/exec"
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// CreateMenu creates the application menu with OS-specific adjustments
func CreateMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()

	// Application menu (macOS only) and File menu (all platforms)
	createApplicationMenu(appMenu, app)

	// Edit menu (for standard editing shortcuts)
	createEditMenu(appMenu, app)

	// View menu
	createViewMenu(appMenu, app)

	// Window menu
	createWindowMenu(appMenu, app)

	// Help menu (rightmost, Windows/Linux only)
	createHelpMenu(appMenu, app)

	return appMenu
}

// spawnNewWindow starts a new instance of the application as a separate process
func spawnNewWindow() {
	execPath, err := os.Executable()
	if err != nil {
		println("Failed to get executable path:", err.Error())
		return
	}

	cmd := exec.Command(execPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		println("Failed to spawn new window:", err.Error())
	}
}

// createApplicationMenu creates the macOS app menu and the File menu (all platforms)
func createApplicationMenu(appMenu *menu.Menu, app *App) {
	// macOS: the application menu is separate from the File menu
	if runtime.GOOS == "darwin" {
		appSubmenu := appMenu.AddSubmenu("Luxury Yacht")

		appSubmenu.AddText("About Luxury Yacht", nil, func(_ *menu.CallbackData) {
			go func() {
				app.ShowAbout()
			}()
		})

		appSubmenu.AddSeparator()

		appSubmenu.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
			go func() {
				app.ShowSettings()
			}()
		})

		appSubmenu.AddText("Hide Luxury Yacht", keys.CmdOrCtrl("h"), func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.Hide(app.Ctx)
				}
			}()
		})

		appSubmenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			if app.Ctx != nil {
				wailsRuntime.Quit(app.Ctx)
			}
		})
	}

	// File menu (all platforms)
	fileMenu := appMenu.AddSubmenu("File")

	// New Window spawns a separate application process
	fileMenu.AddText("New Window", keys.CmdOrCtrl("n"), func(_ *menu.CallbackData) {
		go spawnNewWindow()
	})

	// Close emits an event to the frontend, which decides whether to close a
	// cluster tab or quit the application (Chrome/VS Code style Cmd/Ctrl+W).
	fileMenu.AddText("Close", keys.CmdOrCtrl("w"), func(_ *menu.CallbackData) {
		if app.Ctx != nil {
			app.emitEvent("menu:close")
		}
	})

	// Windows/Linux: Settings and Exit/Quit also live in the File menu
	if runtime.GOOS != "darwin" {
		fileMenu.AddSeparator()

		fileMenu.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
			go func() {
				app.ShowSettings()
			}()
		})

		fileMenu.AddSeparator()

		exitLabel := "Quit"
		if runtime.GOOS == "windows" {
			exitLabel = "Exit"
		}

		fileMenu.AddText(exitLabel, keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			if app.Ctx != nil {
				wailsRuntime.Quit(app.Ctx)
			}
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

	viewMenu.AddText(sidebarText, keys.CmdOrCtrl("b"), func(_ *menu.CallbackData) {
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

	default: // linux and other unix-like systems
		// Linux specific Window menu items
		windowMenu.AddText("Maximize", nil, func(_ *menu.CallbackData) {
			go func() {
				if app.Ctx != nil {
					wailsRuntime.WindowToggleMaximise(app.Ctx)
				}
			}()
		})
	}
}

// createHelpMenu creates the Help menu for Windows and Linux (macOS uses the app menu instead)
func createHelpMenu(appMenu *menu.Menu, app *App) {
	if runtime.GOOS == "darwin" {
		return
	}

	helpMenu := appMenu.AddSubmenu("Help")

	helpMenu.AddText("About Luxury Yacht", nil, func(_ *menu.CallbackData) {
		go func() {
			app.ShowAbout()
		}()
	})
}
