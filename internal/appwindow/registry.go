package appwindow

import (
	"runtime"

	"github.com/luxury-yacht/app/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Registry owns the application's peer workspace windows and their lifecycle.
type Registry struct {
	application    *application.App
	backend        *backend.App
	menu           *application.Menu
	lifecycle      *lifecycle
	newWindow      func(application.WebviewWindowOptions) *application.WebviewWindow
	windowGeometry func(string) (geometry, bool)
}

type geometry struct {
	X         int
	Y         int
	Width     int
	Height    int
	Maximised bool
	Screen    *application.Screen
}

const cascadeOffset = 24

// NewRegistry creates the peer-window registry for a Wails application.
func NewRegistry(
	app *application.App,
	backendApp *backend.App,
	menu *application.Menu,
) *Registry {
	registry := &Registry{
		application: app,
		backend:     backendApp,
		menu:        menu,
		lifecycle:   newLifecycle(),
	}
	registry.newWindow = app.Window.NewWithOptions
	registry.windowGeometry = func(name string) (geometry, bool) {
		window, ok := app.Window.GetByName(name)
		if !ok {
			return geometry{}, false
		}
		width, height := window.Size()
		if width <= 0 || height <= 0 {
			return geometry{}, false
		}
		windowGeometry := geometry{
			Width:     width,
			Height:    height,
			Maximised: window.IsMaximised(),
		}
		if screen, err := window.GetScreen(); err == nil && screen != nil {
			windowGeometry.X, windowGeometry.Y = window.RelativePosition()
			windowGeometry.Screen = screen
		}
		return windowGeometry, true
	}
	return registry
}

// Create adds a peer window. Only the initial peer restores persisted geometry.
func (r *Registry) Create(restoreGeometry bool) *application.WebviewWindow {
	sourceName := r.lifecycle.MostRecent()
	name := r.lifecycle.Add()
	options := windowOptions(name, r.menu)
	if !restoreGeometry && sourceName != "" {
		if sourceGeometry, ok := r.windowGeometry(sourceName); ok {
			options.Width = sourceGeometry.Width
			options.Height = sourceGeometry.Height
			if sourceGeometry.Screen != nil {
				options.InitialPosition = application.WindowXY
				options.X = cascadedCoordinate(
					sourceGeometry.X,
					sourceGeometry.Width,
					sourceGeometry.Screen.WorkArea.Width,
				)
				options.Y = cascadedCoordinate(
					sourceGeometry.Y,
					sourceGeometry.Height,
					sourceGeometry.Screen.WorkArea.Height,
				)
				options.Screen = sourceGeometry.Screen
			}
			if sourceGeometry.Maximised {
				options.StartState = application.WindowStateMaximised
			}
		}
	}
	window := r.newWindow(options)

	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		r.backend.WindowRuntimeReady(name, restoreGeometry)
	})
	window.OnWindowEvent(events.Common.WindowFocus, func(*application.WindowEvent) {
		r.lifecycle.Focus(name)
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		remaining, tracked := r.lifecycle.BeginClose(name)
		if !tracked {
			return
		}
		if remaining == 0 {
			if !r.backend.PrepareQuitFromWindow(name) {
				r.lifecycle.CancelClose(name)
				event.Cancel()
			}
			return
		}
		r.backend.ReleaseWorkspaceWindow(name)
	})
	return window
}

func cascadedCoordinate(position, size, limit int) int {
	maxPosition := limit - size
	if maxPosition < 0 {
		maxPosition = 0
	}
	forward := position + cascadeOffset
	if forward >= 0 && forward <= maxPosition {
		return forward
	}
	backward := position - cascadeOffset
	if backward >= 0 && backward <= maxPosition {
		return backward
	}
	if position < 0 {
		return 0
	}
	if position > maxPosition {
		return maxPosition
	}
	return position
}

// FocusMostRecent shows and focuses the most recently active live peer.
func (r *Registry) FocusMostRecent() {
	name := r.lifecycle.MostRecent()
	window, ok := r.application.Window.GetByName(name)
	if !ok {
		return
	}
	window.Show()
	if window.IsMinimised() {
		window.Restore()
	}
	window.Focus()
}

// PrepareApplicationQuit performs the shared last-window quit preparation.
func (r *Registry) PrepareApplicationQuit() bool {
	return r == nil || r.backend == nil || r.backend.PrepareQuitFromWindow(r.lifecycle.MostRecent())
}

// Count returns the number of live peer windows tracked by the registry.
func (r *Registry) Count() int {
	return r.lifecycle.Count()
}

func windowOptions(name string, nativeMenu *application.Menu) application.WebviewWindowOptions {
	return windowOptionsForPlatform(name, nativeMenu, runtime.GOOS)
}

func windowOptionsForPlatform(name string, nativeMenu *application.Menu, goos string) application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:             name,
		Title:            "Luxury Yacht",
		Width:            1200,
		Height:           800,
		MinWidth:         1100,
		MinHeight:        600,
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
		Windows:            application.WindowsWindow{Theme: application.SystemDefault},
		Linux:              application.LinuxWindow{Menu: nativeMenu},
		UseApplicationMenu: true,
		Zoom:               1,
		ZoomControlEnabled: false,
		Hidden:             goos != "linux",
	}
}
