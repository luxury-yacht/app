//go:build !linux || !cgo || android || server

package appwindow

import "github.com/wailsapp/wails/v3/pkg/application"

func hideNativePanelWindowMenu(_ *application.WebviewWindow) {}
