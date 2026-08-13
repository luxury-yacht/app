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
	app := NewApp(nil)

	setTestAppRuntimeReady(t, app, ctx)

	require.True(t, app.runtimeAvailable())
	backendCtx := app.CtxOrBackground()
	require.NoError(t, backendCtx.Err())
	cancel()
	require.ErrorIs(t, backendCtx.Err(), context.Canceled)
}

func TestDesktopRuntimeRequiresExplicitWindowReadiness(t *testing.T) {
	events := []desktopEvent{}
	app := NewApp(nil)
	app.eventEmitter = func(_ context.Context, name string, data ...interface{}) {
		events = append(events, desktopEvent{name: name, data: data})
	}
	app.setApplicationContext(context.Background())

	app.emitEvent("before-ready", "ignored")
	require.False(t, app.runtimeAvailable())
	require.Empty(t, events)

	require.True(t, app.markRuntimeReady())
	require.True(t, app.runtimeAvailable())
	app.emitEvent("after-ready", "delivered")
	require.Equal(t, []desktopEvent{{name: "after-ready", data: []any{"delivered"}}}, events)
	require.False(t, app.markRuntimeReady(), "the runtime-ready transition must be once-only")
}

func TestBackendResolvesAnyNamedWorkspaceWindowFromWails(t *testing.T) {
	wailsApp := application.New(application.Options{})
	app := NewApp(wailsApp)

	_, err := app.workspaceWindow("workspace-2")
	require.ErrorContains(t, err, `window "workspace-2" is not available`)

	want := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "workspace-2"})
	got, err := app.workspaceWindow("workspace-2")
	require.NoError(t, err)
	require.Same(t, want, got)
}

func TestNamedWorkspaceGeometryRequiresRuntimeReadiness(t *testing.T) {
	wailsApp := application.New(application.Options{})
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "workspace-2"})
	app := NewApp(wailsApp)
	app.setApplicationContext(context.Background())

	_, err := app.workspaceWindowWhenReady("workspace-2")
	require.ErrorContains(t, err, "desktop runtime is not available")
	_, err = app.clipboardText()
	require.ErrorContains(t, err, "desktop runtime is not available")

	app.markRuntimeReady()
	geometry, err := app.readWindowGeometry("workspace-2")
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

	require.Equal(t, []WindowWorkArea{{Width: 1920, Height: 1040, Primary: true}}, NewApp(wailsApp).windowWorkAreas())
	require.Nil(t, NewApp(nil).windowWorkAreas())
}

func TestBackendLifecycleContextTracksApplicationCancellationWithoutRetainingValues(t *testing.T) {
	type contextKey string
	const key contextKey = "wails-value"
	applicationCtx, cancel := context.WithCancel(context.WithValue(context.Background(), key, "private"))
	app := NewApp(nil)
	app.setApplicationContext(applicationCtx)

	backendCtx := app.CtxOrBackground()
	require.Nil(t, backendCtx.Value(key), "backend lifecycle contexts must not retain Wails values")
	require.NoError(t, backendCtx.Err())

	cancel()
	require.ErrorIs(t, backendCtx.Err(), context.Canceled)
}

func TestDesktopRuntimeCanBeCleared(t *testing.T) {
	app := NewApp(nil)
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
	app := NewApp(nil)
	app.eventEmitter = func(context.Context, string, ...interface{}) {}
	app.setApplicationContext(context.Background())
	require.True(t, app.markRuntimeReady())

	allocations := testing.AllocsPerRun(100, func() {
		app.emitEvent("test:event")
	})
	require.Zero(t, allocations)
}
