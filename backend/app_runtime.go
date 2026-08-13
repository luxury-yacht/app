package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/lifecycle"
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

func (a *App) workspaceWindow(name string) (application.Window, error) {
	if a == nil || a.wailsApplication == nil {
		return nil, fmt.Errorf("wails application is not available")
	}
	window, ok := a.wailsApplication.Window.GetByName(name)
	if !ok {
		return nil, fmt.Errorf("window %q is not available", name)
	}
	return window, nil
}

func (a *App) workspaceWindowWhenReady(name string) (application.Window, error) {
	if !a.runtimeAvailable() {
		return nil, fmt.Errorf("desktop runtime is not available")
	}
	return a.workspaceWindow(name)
}

func (a *App) currentWindowWhenReady() (application.Window, error) {
	if !a.runtimeAvailable() {
		return nil, fmt.Errorf("desktop runtime is not available")
	}
	if a == nil || a.wailsApplication == nil {
		return nil, fmt.Errorf("wails application is not available")
	}
	window := a.wailsApplication.Window.Current()
	if window == nil {
		return nil, fmt.Errorf("current window is not available")
	}
	return window, nil
}

// emitCurrentWindowEvent targets UI commands at the active peer. Application
// events continue to use emitEvent and remain process-wide broadcasts.
func (a *App) emitCurrentWindowEvent(name string, data ...any) {
	window, err := a.currentWindowWhenReady()
	if err != nil {
		// The fallback keeps headless tests and pre-native hosts observable.
		a.emitEvent(name, data...)
		return
	}
	window.EmitEvent(name, data...)
}

func (a *App) minimiseCurrentWindow() error {
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return err
	}
	window.Minimise()
	return nil
}

func (a *App) maximiseCurrentWindow() error {
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return err
	}
	window.Maximise()
	return nil
}

func (a *App) restoreCurrentWindow() error {
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return err
	}
	window.Restore()
	return nil
}

func (a *App) toggleCurrentWindowMaximise() error {
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return err
	}
	window.ToggleMaximise()
	return nil
}

func (a *App) promptForOpenFile(options *application.OpenFileDialogOptions) (string, error) {
	if a != nil && a.openFileDialog != nil {
		return a.openFileDialog(options)
	}
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return "", err
	}
	options.Window = window
	return a.wailsApplication.Dialog.OpenFileWithOptions(options).PromptForSingleSelection()
}

func (a *App) promptForSaveFile(options *application.SaveFileDialogOptions) (string, error) {
	if a != nil && a.saveFileDialog != nil {
		return a.saveFileDialog(options)
	}
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return "", err
	}
	options.Window = window
	return a.wailsApplication.Dialog.SaveFileWithOptions(options).PromptForSingleSelection()
}

func (a *App) clipboardText() (string, error) {
	if !a.runtimeAvailable() {
		return "", fmt.Errorf("desktop runtime is not available")
	}
	if a == nil || a.wailsApplication == nil {
		return "", fmt.Errorf("wails application is not available")
	}
	text, ok := a.wailsApplication.Clipboard.Text()
	if !ok {
		return "", fmt.Errorf("clipboard text is not available")
	}
	return text, nil
}

func (a *App) readWindowGeometry(windowName string) (WindowGeometry, error) {
	if a != nil && a.windowGeometry != nil {
		return a.windowGeometry()
	}
	window, err := a.workspaceWindowWhenReady(windowName)
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

func (a *App) windowWorkAreas() []WindowWorkArea {
	if a == nil || a.wailsApplication == nil || a.wailsApplication.Screen == nil {
		return nil
	}
	screens := a.wailsApplication.Screen.GetAll()
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

// setApplicationContext retains only the cancellation signal supplied by the
// desktop application lifecycle. It deliberately does not make UI operations
// available; one peer window must complete its runtime-ready transition first.
func (a *App) setApplicationContext(ctx context.Context) {
	if a == nil {
		return
	}
	a.runtimeReady.Store(false)
	a.appDone = ctx.Done()
}

func (a *App) clearApplicationContext() {
	if a == nil {
		return
	}
	a.runtimeReady.Store(false)
	a.appDone = nil
}

// markRuntimeReady enables desktop operations exactly once for the current
// application lifecycle.
func (a *App) markRuntimeReady() bool {
	return a != nil && a.runtimeReady.CompareAndSwap(false, true)
}

func (a *App) runtimeAvailable() bool {
	return a != nil && a.runtimeReady.Load()
}

// CtxOrBackground returns a context derived only from the application
// cancellation signal, so framework-owned context values do not leak into
// backend operations.
func (a *App) CtxOrBackground() context.Context {
	if a == nil {
		return context.Background()
	}
	return lifecycle.Context(a.appDone)
}
