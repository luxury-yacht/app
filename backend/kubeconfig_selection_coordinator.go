package backend

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// selectionMutation carries metadata for a coordinated cluster mutation operation.
// Phase 1 keeps execution serialized while plumbing generation-aware boundaries.
type selectionMutation struct {
	generation uint64
	reason     string
	startedAt  time.Time
	ctx        context.Context
	phases     selectionMutationPhases
}

type selectionMutationPhases struct {
	intent        time.Duration
	commit        time.Duration
	clientSync    time.Duration
	refresh       time.Duration
	objectCatalog time.Duration
}

// runSelectionMutation serializes a cluster-selection/runtime mutation path,
// increments selection generation, and executes the mutation callback.
func (a *App) runSelectionMutation(reason string, fn func(*selectionMutation) error) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	if fn == nil {
		return fmt.Errorf("selection mutation callback is nil")
	}

	requestStarted := time.Now()
	a.selectionDiagnosticsEnqueue()

	generation := a.selectionGeneration.Add(1)
	// Preempt work from previous generations immediately, even before this
	// mutation acquires the serialized mutation slot.
	a.cancelActiveSelectionGeneration()

	// Keep coordinated mutations sequential while allowing generation preemption.
	a.selectionMutationMu.Lock()
	queueWait := time.Since(requestStarted)
	defer a.selectionMutationMu.Unlock()

	// If a newer generation arrived while waiting for the mutation slot, skip.
	if generation != a.selectionGeneration.Load() {
		a.selectionDiagnosticsFinalize(selectionMutationSample{
			queueMs:    queueWait.Milliseconds(),
			totalMs:    time.Since(requestStarted).Milliseconds(),
			reason:     reason,
			superseded: true,
		})
		return nil
	}

	var mutation selectionMutation
	a.withKubeconfigStateTransition(func() {
		mutation = selectionMutation{
			generation: generation,
			reason:     reason,
			startedAt:  time.Now(),
			ctx:        a.activateSelectionGeneration(),
		}
	})

	if a.logger != nil {
		a.logger.Debug(
			fmt.Sprintf("Selection mutation start (reason=%s generation=%d)", mutation.reason, mutation.generation),
			"KubeconfigManager",
		)
	}

	err := fn(&mutation)
	canceled := errors.Is(err, context.Canceled)
	sample := selectionMutationSample{
		queueMs:      queueWait.Milliseconds(),
		totalMs:      time.Since(requestStarted).Milliseconds(),
		intentMs:     mutation.phases.intent.Milliseconds(),
		commitMs:     mutation.phases.commit.Milliseconds(),
		clientSyncMs: mutation.phases.clientSync.Milliseconds(),
		refreshMs:    mutation.phases.refresh.Milliseconds(),
		catalogMs:    mutation.phases.objectCatalog.Milliseconds(),
		reason:       reason,
		failed:       err != nil && !canceled,
		canceled:     canceled,
	}
	if err != nil {
		sample.errorText = err.Error()
	}
	a.selectionDiagnosticsFinalize(sample)
	if a.logger != nil {
		status := "ok"
		if sample.superseded {
			status = "superseded"
		} else if sample.canceled {
			status = "canceled"
		} else if sample.failed {
			status = "failed"
		}
		a.logger.Debug(
			fmt.Sprintf(
				"Selection mutation complete (reason=%s generation=%d status=%s queueMs=%d totalMs=%d intentMs=%d clientSyncMs=%d refreshMs=%d catalogMs=%d)",
				reason,
				mutation.generation,
				status,
				sample.queueMs,
				sample.totalMs,
				sample.intentMs,
				sample.clientSyncMs,
				sample.refreshMs,
				sample.catalogMs,
			),
			"KubeconfigManager",
		)
	}

	if canceled {
		return nil
	}
	return err
}

// runSelectionMutationAsync executes a coordinated mutation asynchronously.
// Errors are logged since callers are typically event/recovery callbacks.
func (a *App) runSelectionMutationAsync(reason string, fn func(*selectionMutation) error) {
	if a == nil {
		return
	}
	go func() {
		if err := a.runSelectionMutation(reason, fn); err != nil && a.logger != nil {
			a.logger.Warn(
				fmt.Sprintf("Selection mutation failed (reason=%s): %v", reason, err),
				"KubeconfigManager",
			)
		}
	}()
}

// isSelectionGenerationCurrent reports whether expected generation is still current.
func (a *App) isSelectionGenerationCurrent(expected uint64) bool {
	if a == nil {
		return false
	}
	return a.selectionGeneration.Load() == expected
}

func (a *App) cancelActiveSelectionGeneration() {
	if a == nil {
		return
	}
	a.selectionGenCtxMu.Lock()
	cancel := a.selectionGenCancel
	a.selectionGenCancel = nil
	a.selectionGenCtxMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *App) activateSelectionGeneration() context.Context {
	if a == nil {
		return context.Background()
	}

	base := context.Background()
	if a.Ctx != nil {
		base = a.Ctx
	}

	ctx, cancel := context.WithCancel(base)

	a.selectionGenCtxMu.Lock()
	if prev := a.selectionGenCancel; prev != nil {
		prev()
	}
	a.selectionGenCancel = cancel
	a.selectionGenCtxMu.Unlock()

	return ctx
}

// withKubeconfigStateTransition runs a short state-transition critical section.
func (a *App) withKubeconfigStateTransition(fn func()) {
	if a == nil || fn == nil {
		return
	}
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()
	fn()
}
