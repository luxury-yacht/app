package backend

import "context"

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
