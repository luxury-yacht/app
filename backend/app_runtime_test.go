package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type desktopEvent struct {
	name string
	data []any
}

func TestSetTestAppRuntimeReadySetsContextAndReadiness(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	app := NewApplicationRuntime(nil)

	setTestAppRuntimeReady(t, app.Lifecycle, ctx)

	require.True(t, app.Lifecycle.runtimeAvailable())
	backendCtx := app.Lifecycle.CtxOrBackground()
	require.NoError(t, backendCtx.Err())
	cancel()
	require.ErrorIs(t, backendCtx.Err(), context.Canceled)
}

func TestDesktopRuntimeRequiresExplicitWindowReadiness(t *testing.T) {
	events := []desktopEvent{}
	app := NewApplicationRuntime(nil)
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, data ...interface{}) {
		events = append(events, desktopEvent{name: name, data: data})
	}
	app.Lifecycle.setApplicationContext(context.Background())

	app.Lifecycle.emitEvent("before-ready", "ignored")
	require.False(t, app.Lifecycle.runtimeAvailable())
	require.Empty(t, events)

	require.True(t, app.Lifecycle.markRuntimeReady())
	require.True(t, app.Lifecycle.runtimeAvailable())
	app.Lifecycle.emitEvent("after-ready", "delivered")
	require.Equal(t, []desktopEvent{{name: "after-ready", data: []any{"delivered"}}}, events)
	require.False(t, app.Lifecycle.markRuntimeReady(), "the runtime-ready transition must be once-only")
}

func TestBackendResolvesAnyNamedWorkspaceWindowFromWails(t *testing.T) {
	wailsApp := application.New(application.Options{})
	app := NewApplicationRuntime(wailsApp)

	_, err := app.DesktopShell.workspaceWindow("workspace-2")
	require.ErrorContains(t, err, `window "workspace-2" is not available`)

	want := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "workspace-2"})
	got, err := app.DesktopShell.workspaceWindow("workspace-2")
	require.NoError(t, err)
	require.Same(t, want, got)
}

func TestNamedWorkspaceGeometryRequiresRuntimeReadiness(t *testing.T) {
	wailsApp := application.New(application.Options{})
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "workspace-2"})
	app := NewApplicationRuntime(wailsApp)
	app.Lifecycle.setApplicationContext(context.Background())

	_, err := app.DesktopShell.workspaceWindowWhenReady("workspace-2")
	require.ErrorContains(t, err, "desktop runtime is not available")
	_, err = app.DesktopShell.clipboardText()
	require.ErrorContains(t, err, "desktop runtime is not available")

	app.Lifecycle.markRuntimeReady()
	geometry, err := app.DesktopShell.readWindowGeometry("workspace-2")
	require.NoError(t, err)
	require.Equal(t, WindowGeometry{}, geometry)
}

func TestWorkspaceWindowWorkAreasComeFromWailsScreenManager(t *testing.T) {
	wailsApp := application.New(application.Options{})
	require.NoError(t, wailsApp.Screen.LayoutScreens([]*application.Screen{
		{
			ID:               "primary",
			ScaleFactor:      1,
			Bounds:           application.Rect{Width: 1920, Height: 1080},
			WorkArea:         application.Rect{Width: 1920, Height: 1040},
			PhysicalBounds:   application.Rect{Width: 1920, Height: 1080},
			PhysicalWorkArea: application.Rect{Width: 1920, Height: 1040},
			IsPrimary:        true,
		},
	}))

	require.Equal(t, []WindowWorkArea{{Width: 1920, Height: 1040, Primary: true}}, NewApplicationRuntime(wailsApp).DesktopShell.windowWorkAreas())
	require.Nil(t, NewApplicationRuntime(nil).DesktopShell.windowWorkAreas())
}

func TestBackendLifecycleContextTracksApplicationCancellationWithoutRetainingValues(t *testing.T) {
	type contextKey string
	const key contextKey = "wails-value"
	applicationCtx, cancel := context.WithCancel(context.WithValue(context.Background(), key, "private"))
	app := NewApplicationRuntime(nil)
	app.Lifecycle.setApplicationContext(applicationCtx)

	backendCtx := app.Lifecycle.CtxOrBackground()
	require.Nil(t, backendCtx.Value(key), "backend lifecycle contexts must not retain Wails values")
	require.NoError(t, backendCtx.Err())

	cancel()
	require.ErrorIs(t, backendCtx.Err(), context.Canceled)
}

func TestDesktopRuntimeCanBeCleared(t *testing.T) {
	app := NewApplicationRuntime(nil)
	app.Lifecycle.setApplicationContext(context.Background())
	require.True(t, app.Lifecycle.markRuntimeReady())
	require.True(t, app.Lifecycle.runtimeAvailable())

	app.Lifecycle.clearApplicationContext()
	require.False(t, app.Lifecycle.runtimeAvailable())
	require.Nil(t, app.Lifecycle.CtxOrBackground().Done())
}

func TestNilApplicationLifecycleUsesBackgroundContext(t *testing.T) {
	var lifecycle *ApplicationLifecycle
	lifecycle.setApplicationContext(context.Background())

	require.False(t, lifecycle.runtimeAvailable())
	require.False(t, lifecycle.markRuntimeReady())
	require.Nil(t, lifecycle.CtxOrBackground().Done())
}

func TestEmitEventDoesNotAllocateLifecycleContext(t *testing.T) {
	app := NewApplicationRuntime(nil)
	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {}
	app.Lifecycle.setApplicationContext(context.Background())
	require.True(t, app.Lifecycle.markRuntimeReady())

	allocations := testing.AllocsPerRun(100, func() {
		app.Lifecycle.emitEvent("test:event")
	})
	require.Zero(t, allocations)
}

func TestEmitEventRequiresRuntimeReadiness(t *testing.T) {
	app := NewApplicationRuntime(nil)
	called := false
	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {
		called = true
	}

	app.Lifecycle.emitEvent("something")
	require.False(t, called)

	app.Lifecycle.setApplicationContext(context.Background())
	require.True(t, app.Lifecycle.markRuntimeReady())
	app.Lifecycle.emitEvent("something")
	require.True(t, called)
}
