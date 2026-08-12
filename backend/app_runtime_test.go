package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type runtimeRecordingDesktop struct {
	events []desktopEvent
}

type desktopEvent struct {
	name string
	data []any
}

func (d *runtimeRecordingDesktop) EmitEvent(name string, data ...any) bool {
	d.events = append(d.events, desktopEvent{name: name, data: data})
	return true
}

func (*runtimeRecordingDesktop) ShowErrorDialog(string, string) {}
func (*runtimeRecordingDesktop) OpenFile(OpenFileDialogOptions) (string, error) {
	return "", nil
}
func (*runtimeRecordingDesktop) SaveFile(SaveFileDialogOptions) (string, error) {
	return "", nil
}
func (*runtimeRecordingDesktop) OpenDirectory(OpenFileDialogOptions) (string, error) {
	return "", nil
}
func (*runtimeRecordingDesktop) ClipboardText() (string, error) { return "", nil }
func (*runtimeRecordingDesktop) RefreshMenu() error             { return nil }
func (*runtimeRecordingDesktop) HideApplication()               {}
func (*runtimeRecordingDesktop) QuitApplication()               {}
func (*runtimeRecordingDesktop) ShowMainWindow() error          { return nil }
func (*runtimeRecordingDesktop) SetMainWindowSize(int, int) error {
	return nil
}
func (*runtimeRecordingDesktop) SetMainWindowPosition(int, int) error {
	return nil
}
func (*runtimeRecordingDesktop) MinimiseMainWindow() error       { return nil }
func (*runtimeRecordingDesktop) MaximiseMainWindow() error       { return nil }
func (*runtimeRecordingDesktop) RestoreMainWindow() error        { return nil }
func (*runtimeRecordingDesktop) ToggleMainWindowMaximise() error { return nil }
func (*runtimeRecordingDesktop) BringMainWindowToFront() error   { return nil }
func (*runtimeRecordingDesktop) MainWindowGeometry() (WindowGeometry, error) {
	return WindowGeometry{}, nil
}
func (*runtimeRecordingDesktop) MainWindowWorkAreas() []WindowWorkArea { return nil }

func TestDesktopRuntimeRequiresExplicitWindowReadiness(t *testing.T) {
	desktop := &runtimeRecordingDesktop{}
	app := NewApp(desktop)
	app.setApplicationContext(context.Background())

	app.emitEvent("before-ready", "ignored")
	require.False(t, app.runtimeAvailable())
	require.Empty(t, desktop.events)

	require.True(t, app.markRuntimeReady())
	require.True(t, app.runtimeAvailable())
	app.emitEvent("after-ready", "delivered")
	require.Equal(t, []desktopEvent{{name: "after-ready", data: []any{"delivered"}}}, desktop.events)
	require.False(t, app.markRuntimeReady(), "the runtime-ready transition must be once-only")
}

func TestBackendLifecycleContextTracksApplicationCancellationWithoutRetainingValues(t *testing.T) {
	type contextKey string
	const key contextKey = "wails-value"
	applicationCtx, cancel := context.WithCancel(context.WithValue(context.Background(), key, "private"))
	desktop := &runtimeRecordingDesktop{}
	app := NewApp(desktop)
	app.setApplicationContext(applicationCtx)

	backendCtx := app.CtxOrBackground()
	require.Nil(t, backendCtx.Value(key), "backend lifecycle contexts must not retain Wails values")
	require.NoError(t, backendCtx.Err())

	cancel()
	require.ErrorIs(t, backendCtx.Err(), context.Canceled)
}

func TestDesktopRuntimeCanBeCleared(t *testing.T) {
	app := NewApp(&runtimeRecordingDesktop{})
	app.setApplicationContext(context.Background())
	require.True(t, app.markRuntimeReady())
	require.True(t, app.runtimeAvailable())

	app.clearApplicationContext()
	require.False(t, app.runtimeAvailable())
	require.Nil(t, app.CtxOrBackground().Done())
}

func TestNilAppUsesBackgroundContext(t *testing.T) {
	var app *App
	app.setApplicationContext(context.Background())

	require.False(t, app.runtimeAvailable())
	require.False(t, app.markRuntimeReady())
	require.Nil(t, app.CtxOrBackground().Done())
}

func TestEmitEventDoesNotAllocateLifecycleContext(t *testing.T) {
	desktop := &runtimeRecordingDesktop{}
	app := NewApp(desktop)
	app.setApplicationContext(context.Background())
	require.True(t, app.markRuntimeReady())

	allocations := testing.AllocsPerRun(100, func() {
		app.emitEvent("test:event")
	})
	require.Zero(t, allocations)
}
