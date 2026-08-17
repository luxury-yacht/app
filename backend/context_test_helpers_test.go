package backend

import (
	"context"
	"testing"
)

func setTestAppRuntimeReady(t testing.TB, lifecycle *ApplicationLifecycle, ctx context.Context) {
	t.Helper()
	lifecycle.setApplicationContext(ctx)
	if !lifecycle.markRuntimeReady() {
		t.Fatal("expected app runtime to become ready")
	}
}

func setRefreshRuntimeContextForTest(refreshCoordinator *RefreshCoordinator, parent context.Context) {
	refreshCoordinator.refreshRuntimeMu.Lock()
	defer refreshCoordinator.refreshRuntimeMu.Unlock()
	if refreshCoordinator.refreshCancel != nil {
		refreshCoordinator.refreshCancel()
	}
	if parent == nil {
		refreshCoordinator.refreshDone = nil
		refreshCoordinator.refreshCancel = nil
		return
	}
	ctx, cancel := context.WithCancel(parent)
	refreshCoordinator.refreshDone = ctx.Done()
	refreshCoordinator.refreshCancel = cancel
	refreshCoordinator.refreshRuntimeStopped = false
}
