package main

import (
	"runtime"

	"github.com/luxury-yacht/app/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type workspaceWindowRegistry struct {
	application    *application.App
	backend        *backend.App
	menu           *application.Menu
	lifecycle      *workspaceWindowLifecycle
	newWindow      func(application.WebviewWindowOptions) *application.WebviewWindow
	windowGeometry func(string) (workspaceWindowGeometry, bool)
}

type workspaceWindowGeometry struct {
	X         int
	Y         int
	Width     int
	Height    int
	Maximised bool
	Screen    *application.Screen
}

const workspaceWindowCascadeOffset = 24

func newWorkspaceWindowRegistry(
	app *application.App,
	backendApp *backend.App,
	menu *application.Menu,
) *workspaceWindowRegistry {
	registry := &workspaceWindowRegistry{
		application: app,
		backend:     backendApp,
		menu:        menu,
		lifecycle:   newWorkspaceWindowLifecycle(),
	}
	registry.newWindow = app.Window.NewWithOptions
	registry.windowGeometry = func(name string) (workspaceWindowGeometry, bool) {
		window, ok := app.Window.GetByName(name)
		if !ok {
			return workspaceWindowGeometry{}, false
		}
		width, height := window.Size()
		if width <= 0 || height <= 0 {
			return workspaceWindowGeometry{}, false
		}
		geometry := workspaceWindowGeometry{
			Width:     width,
			Height:    height,
			Maximised: window.IsMaximised(),
		}
		if screen, err := window.GetScreen(); err == nil && screen != nil {
			geometry.X, geometry.Y = window.RelativePosition()
			geometry.Screen = screen
		}
		return geometry, true
	}
	return registry
}

func (r *workspaceWindowRegistry) Create(restoreGeometry bool) *application.WebviewWindow {
	sourceName := r.lifecycle.MostRecent()
	name := r.lifecycle.Add()
	options := workspaceWindowOptions(name, r.menu)
	if !restoreGeometry && sourceName != "" {
		if geometry, ok := r.windowGeometry(sourceName); ok {
			options.Width = geometry.Width
			options.Height = geometry.Height
			if geometry.Screen != nil {
				options.InitialPosition = application.WindowXY
				options.X = cascadedWorkspaceWindowCoordinate(
					geometry.X,
					geometry.Width,
					geometry.Screen.WorkArea.Width,
				)
				options.Y = cascadedWorkspaceWindowCoordinate(
					geometry.Y,
					geometry.Height,
					geometry.Screen.WorkArea.Height,
				)
				options.Screen = geometry.Screen
			}
			if geometry.Maximised {
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

func cascadedWorkspaceWindowCoordinate(position, size, limit int) int {
	maxPosition := limit - size
	if maxPosition < 0 {
		maxPosition = 0
	}
	forward := position + workspaceWindowCascadeOffset
	if forward >= 0 && forward <= maxPosition {
		return forward
	}
	backward := position - workspaceWindowCascadeOffset
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

func (r *workspaceWindowRegistry) FocusMostRecent() {
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

func (r *workspaceWindowRegistry) PrepareApplicationQuit() bool {
	return r == nil || r.backend == nil || r.backend.PrepareQuitFromWindow(r.lifecycle.MostRecent())
}

func workspaceWindowOptions(name string, nativeMenu *application.Menu) application.WebviewWindowOptions {
	return workspaceWindowOptionsForPlatform(name, nativeMenu, runtime.GOOS)
}

func workspaceWindowOptionsForPlatform(name string, nativeMenu *application.Menu, goos string) application.WebviewWindowOptions {
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
