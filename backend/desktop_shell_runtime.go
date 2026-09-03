package backend

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type WindowGeometry struct {
	X         int
	Y         int
	Width     int
	Height    int
	Maximised bool
}

// WindowWorkArea is a screen's usable logical-coordinate rectangle. Wails v3
// accounts for per-screen scaling before exposing these values.
type WindowWorkArea struct {
	X       int
	Y       int
	Width   int
	Height  int
	Primary bool
}

func (s *DesktopShell) workspaceWindow(name string) (application.Window, error) {
	if s == nil || s.application == nil {
		return nil, fmt.Errorf("wails application is not available")
	}
	window, ok := s.application.Window.GetByName(name)
	if !ok {
		return nil, fmt.Errorf("window %q is not available", name)
	}
	return window, nil
}

func (s *DesktopShell) workspaceWindowWhenReady(name string) (application.Window, error) {
	if !s.runtimeAvailable() {
		return nil, fmt.Errorf("desktop runtime is not available")
	}
	return s.workspaceWindow(name)
}

func (s *DesktopShell) currentWindowWhenReady() (application.Window, error) {
	if !s.runtimeAvailable() {
		return nil, fmt.Errorf("desktop runtime is not available")
	}
	if s == nil || s.application == nil {
		return nil, fmt.Errorf("wails application is not available")
	}
	window := s.application.Window.Current()
	if window == nil {
		return nil, fmt.Errorf("current window is not available")
	}
	return window, nil
}

// emitCurrentWindowEvent targets UI commands at the active peer. Application
// events continue to use emitEvent and remain process-wide broadcasts.
func (s *DesktopShell) emitCurrentWindowEvent(name string, data ...any) {
	window, err := s.currentWindowWhenReady()
	if err != nil {
		// The fallback keeps headless tests and pre-native hosts observable.
		s.emitFallback(name, data...)
		return
	}
	window.EmitEvent(name, data...)
}

func (s *DesktopShell) promptForOpenFile(options *application.OpenFileDialogOptions) (string, error) {
	if s != nil && s.openFileDialog != nil {
		return s.openFileDialog(options)
	}
	window, err := s.currentWindowWhenReady()
	if err != nil {
		return "", err
	}
	options.Window = window
	return s.application.Dialog.OpenFileWithOptions(options).PromptForSingleSelection()
}

func (s *DesktopShell) promptForSaveFile(options *application.SaveFileDialogOptions) (string, error) {
	if s != nil && s.saveFileDialog != nil {
		return s.saveFileDialog(options)
	}
	window, err := s.currentWindowWhenReady()
	if err != nil {
		return "", err
	}
	options.Window = window
	return s.application.Dialog.SaveFileWithOptions(options).PromptForSingleSelection()
}

func (s *DesktopShell) clipboardText() (string, error) {
	if !s.runtimeAvailable() {
		return "", fmt.Errorf("desktop runtime is not available")
	}
	if s == nil || s.application == nil {
		return "", fmt.Errorf("wails application is not available")
	}
	text, ok := s.application.Clipboard.Text()
	if !ok {
		return "", fmt.Errorf("clipboard text is not available")
	}
	return text, nil
}

func (s *DesktopShell) readWindowGeometry(windowName string) (WindowGeometry, error) {
	if s != nil && s.windowGeometry != nil {
		return s.windowGeometry()
	}
	window, err := s.workspaceWindowWhenReady(windowName)
	if err != nil {
		return WindowGeometry{}, err
	}
	x, y := window.Position()
	width, height := window.Size()
	return WindowGeometry{
		X:         x,
		Y:         y,
		Width:     width,
		Height:    height,
		Maximised: window.IsMaximised(),
	}, nil
}

func (s *DesktopShell) windowWorkAreas() []WindowWorkArea {
	if s == nil || s.application == nil || s.application.Screen == nil {
		return nil
	}
	screens := s.application.Screen.GetAll()
	result := make([]WindowWorkArea, 0, len(screens))
	for _, screen := range screens {
		if screen == nil {
			continue
		}
		result = append(result, WindowWorkArea{
			X:       screen.WorkArea.X,
			Y:       screen.WorkArea.Y,
			Width:   screen.WorkArea.Width,
			Height:  screen.WorkArea.Height,
			Primary: screen.IsPrimary,
		})
	}
	return result
}
