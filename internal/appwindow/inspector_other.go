//go:build !darwin || !cgo || ios || server || production

package appwindow

import "github.com/wailsapp/wails/v3/pkg/application"

const nativeInspectorEnabled = false

func configureNativeInspector(_ *application.WebviewWindow) {
	// Native Inspector setup is intentionally disabled for these build targets.
}
