//go:build darwin && cgo && !ios && !server && !production

package appwindow

/*
// Use Wails' own bridge so the private_mac_apis build opt-in remains authoritative.
void wailsPrivateEnableWebInspector(void *window);
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

const nativeInspectorEnabled = true

func configureNativeInspector(window *application.WebviewWindow) {
	// Wails enables Safari inspection on modern macOS, but the native Inspect
	// Element menu still requires developer extras. The registry waits for ready.
	application.InvokeSync(func() {
		if handle := window.NativeWindow(); handle != nil {
			C.wailsPrivateEnableWebInspector(handle)
		}
	})
}
