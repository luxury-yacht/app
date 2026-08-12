package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/lifecycle"
)

// Desktop is the process-scoped boundary between backend behavior and the
// native desktop runtime. Additional capabilities belong here rather than in
// Wails-specific backend call sites.
type Desktop interface {
	EmitEvent(name string, data ...any) bool
	ShowErrorDialog(title, message string)
	OpenFile(options OpenFileDialogOptions) (string, error)
	SaveFile(options SaveFileDialogOptions) (string, error)
	OpenDirectory(options OpenFileDialogOptions) (string, error)
	ClipboardText() (string, error)
	RefreshMenu() error
	HideApplication()
	QuitApplication()
	ShowMainWindow() error
	SetMainWindowSize(width, height int) error
	SetMainWindowPosition(x, y int) error
	MinimiseMainWindow() error
	MaximiseMainWindow() error
	RestoreMainWindow() error
	ToggleMainWindowMaximise() error
	BringMainWindowToFront() error
	MainWindowGeometry() (WindowGeometry, error)
	MainWindowWorkAreas() []WindowWorkArea
}

type FileFilter struct {
	DisplayName string
	Pattern     string
}

type OpenFileDialogOptions struct {
	Title     string
	Directory string
	Filters   []FileFilter
}

type SaveFileDialogOptions struct {
	Title                string
	Directory            string
	Filename             string
	Filters              []FileFilter
	CanCreateDirectories bool
}

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

func (a *App) desktopAvailable() bool {
	return a != nil && a.desktop != nil && a.runtimeAvailable()
}

func (a *App) minimiseMainWindow() error {
	if !a.desktopAvailable() {
		return fmt.Errorf("desktop runtime is not available")
	}
	return a.desktop.MinimiseMainWindow()
}

func (a *App) maximiseMainWindow() error {
	if !a.desktopAvailable() {
		return fmt.Errorf("desktop runtime is not available")
	}
	return a.desktop.MaximiseMainWindow()
}

func (a *App) restoreMainWindow() error {
	if !a.desktopAvailable() {
		return fmt.Errorf("desktop runtime is not available")
	}
	return a.desktop.RestoreMainWindow()
}

func (a *App) toggleMainWindowMaximise() error {
	if !a.desktopAvailable() {
		return fmt.Errorf("desktop runtime is not available")
	}
	return a.desktop.ToggleMainWindowMaximise()
}

// setApplicationContext retains only the cancellation signal supplied by the
// desktop application lifecycle. It deliberately does not make UI operations
// available; the main window must complete its runtime-ready transition first.
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
