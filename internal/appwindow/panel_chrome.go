package appwindow

import "github.com/wailsapp/wails/v3/pkg/application"

func configureNativePanelWindow(window *application.WebviewWindow) {
	if window == nil {
		return
	}
	window.SetTitle("")
	hideNativePanelWindowMenu(window)
}
