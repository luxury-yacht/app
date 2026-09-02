//go:build !darwin || !cgo || ios || server

package appwindow

func configureNativeTabDragAnimation() {
	// Only the macOS WebKit implementation needs a native failed-drag animation override.
}
