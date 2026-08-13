package main

import (
	"runtime"

	"github.com/luxury-yacht/app/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type workspaceWindowRegistry struct {
	application *application.App
	backend     *backend.App
	menu        *application.Menu
	lifecycle   *workspaceWindowLifecycle
}

func newWorkspaceWindowRegistry(
	app *application.App,
	backendApp *backend.App,
	menu *application.Menu,
) *workspaceWindowRegistry {
	return &workspaceWindowRegistry{
		application: app,
		backend:     backendApp,
		menu:        menu,
		lifecycle:   newWorkspaceWindowLifecycle(),
	}
}

func (r *workspaceWindowRegistry) Create(restoreGeometry bool) *application.WebviewWindow {
	name := r.lifecycle.Add()
	window := r.application.Window.NewWithOptions(workspaceWindowOptions(name, r.menu))

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
