package backend

import (
	"context"
	"testing"
)

func setTestAppRuntimeReady(t testing.TB, app *App, ctx context.Context) {
	t.Helper()
	app.setApplicationContext(ctx)
	if !app.markRuntimeReady() {
		t.Fatal("expected app runtime to become ready")
	}
}

func setRefreshRuntimeContextForTest(app *App, parent context.Context) {
	app.refreshRuntimeMu.Lock()
	defer app.refreshRuntimeMu.Unlock()
	if app.refreshCancel != nil {
		app.refreshCancel()
	}
	if parent == nil {
		app.refreshDone = nil
		app.refreshCancel = nil
		return
	}
	ctx, cancel := context.WithCancel(parent)
	app.refreshDone = ctx.Done()
	app.refreshCancel = cancel
	app.refreshRuntimeStopped = false
}
