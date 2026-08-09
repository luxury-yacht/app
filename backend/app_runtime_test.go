package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRuntimeContextCapabilityPreservesWailsValues(t *testing.T) {
	type contextKey string
	const key contextKey = "runtime-value"
	runtimeCtx := context.WithValue(context.Background(), key, "available-to-wails")
	app := &App{}
	app.setRuntimeContext(runtimeCtx)

	var value any
	require.True(t, app.runWithRuntimeContext(func(ctx context.Context) {
		value = ctx.Value(key)
	}))
	require.Equal(t, "available-to-wails", value)
	require.Nil(t, app.CtxOrBackground().Value(key), "backend lifecycle contexts must not retain Wails values")
}

func TestBackendLifecycleContextTracksRuntimeCancellation(t *testing.T) {
	runtimeCtx, cancel := context.WithCancel(context.Background())
	app := &App{}
	app.setRuntimeContext(runtimeCtx)

	backendCtx := app.CtxOrBackground()
	require.NoError(t, backendCtx.Err())
	cancel()
	require.ErrorIs(t, backendCtx.Err(), context.Canceled)
}

func TestRuntimeContextCapabilityRejectsMissingRuntime(t *testing.T) {
	app := &App{}
	require.False(t, app.runWithRuntimeContext(func(context.Context) {
		t.Fatal("action must not run without a runtime context")
	}))
}

func TestRuntimeEventEmitterBindsEmitterAndRuntimeContext(t *testing.T) {
	type contextKey string
	const key contextKey = "wails-runtime"
	runtimeCtx := context.WithValue(context.Background(), key, "bound")

	var receivedContext context.Context
	var receivedName string
	emitter := bindRuntimeEventEmitter(runtimeCtx, func(ctx context.Context, name string, _ ...interface{}) {
		receivedContext = ctx
		receivedName = name
	})
	emitter(context.Background(), "test:event")

	require.Equal(t, "bound", receivedContext.Value(key))
	require.Equal(t, "test:event", receivedName)
}
