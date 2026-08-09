package backend

import (
	"context"

	"github.com/luxury-yacht/app/backend/internal/lifecycle"
)

// setRuntimeContext separates the Wails-only context capability from the
// cancellation signal used by backend operations.
func (a *App) setRuntimeContext(ctx context.Context) {
	if a == nil {
		return
	}
	if ctx == nil {
		a.runtimeReady = false
		a.appDone = nil
		a.withRuntimeContext = nil
		return
	}
	a.runtimeReady = true
	a.appDone = ctx.Done()
	a.withRuntimeContext = func(action func(context.Context)) {
		if action != nil {
			action(ctx)
		}
	}
}

func (a *App) runtimeAvailable() bool {
	return a != nil && a.runtimeReady && a.withRuntimeContext != nil
}

func (a *App) runWithRuntimeContext(action func(context.Context)) bool {
	if !a.runtimeAvailable() {
		return false
	}
	a.withRuntimeContext(action)
	return true
}

// CtxOrBackground returns the backend lifecycle cancellation context. Wails
// values stay confined to runWithRuntimeContext.
func (a *App) CtxOrBackground() context.Context {
	if a == nil {
		return context.Background()
	}
	return lifecycle.Context(a.appDone)
}
