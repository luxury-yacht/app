package backend

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/lifecycle"
)

// selectionMutation carries metadata for a coordinated cluster mutation
// operation and keeps execution serialized across generation-aware boundaries.
type selectionMutation struct {
	generation uint64
	reason     string
	startedAt  time.Time
	done       <-chan struct{}
	phases     selectionMutationPhases
}

func (m *selectionMutation) context() context.Context {
	if m == nil || m.done == nil {
		return context.Background()
	}
	return lifecycle.Context(m.done)
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
func (a *WorkspaceCoordinator) runSelectionMutation(reason string, fn func(*selectionMutation) error) error {
	return a.runSelectionMutationWithQueuePolicy(reason, true, fn)
}

// runOrderedSelectionMutation preserves every queued mutation. Peer windows
// own independent tab sets, so a later command from one peer must not supersede
// an earlier command from another peer.
func (a *WorkspaceCoordinator) runOrderedSelectionMutation(reason string, fn func(*selectionMutation) error) error {
	return a.runSelectionMutationWithQueuePolicy(reason, false, fn)
}

func (a *WorkspaceCoordinator) runSelectionMutationWithQueuePolicy(
	reason string,
	supersedeQueued bool,
	fn func(*selectionMutation) error,
) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	if fn == nil {
		return fmt.Errorf("selection mutation callback is nil")
	}
	finishDrain := a.beginSelectionMutationDrain()
	defer finishDrain()

	requestStarted := time.Now()
	a.selectionDiagnosticsEnqueue()

	var generation uint64
	if supersedeQueued {
		generation = a.selectionGeneration.Add(1)
		// Preempt work from previous generations immediately, even before this
		// mutation acquires the serialized mutation slot.
		a.cancelActiveSelectionGeneration()
	}

	// Keep coordinated mutations sequential while allowing generation preemption.
	a.selectionMutationMu.Lock()
	queueWait := time.Since(requestStarted)
	defer a.selectionMutationMu.Unlock()

	// If a newer superseding generation arrived while waiting for the mutation
	// slot, skip. Ordered peer mutations allocate their generation only after
	// reaching the front of the queue, so every peer's state is committed.
	if supersedeQueued && generation != a.selectionGeneration.Load() {
		a.selectionDiagnosticsFinalize(selectionMutationSample{
			queueMs:    queueWait.Milliseconds(),
			totalMs:    time.Since(requestStarted).Milliseconds(),
			reason:     reason,
			superseded: true,
		})
		return nil
	}
	if !supersedeQueued {
		generation = a.selectionGeneration.Add(1)
		a.cancelActiveSelectionGeneration()
	}

	var mutation selectionMutation
	a.withKubeconfigStateTransition(func() {
		generationCtx := a.activateSelectionGeneration()
		mutation = selectionMutation{
			generation: generation,
			reason:     reason,
			startedAt:  time.Now(),
			done:       generationCtx.Done(),
		}
	})

	a.logger.Debug(
		fmt.Sprintf("Selection mutation start (reason=%s generation=%d)", mutation.reason, mutation.generation),
		"KubeconfigManager",
	)

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
func (a *WorkspaceCoordinator) runSelectionMutationAsync(reason string, fn func(*selectionMutation) error) {
	if a == nil {
		return
	}
	go func() {
		if err := a.runSelectionMutation(reason, fn); err != nil {
			a.logger.Warn(
				fmt.Sprintf("Selection mutation failed (reason=%s): %v", reason, err),
				"KubeconfigManager",
			)
		}
	}()
}

func (a *WorkspaceCoordinator) selectionMutationDrainCondLocked() *sync.Cond {
	if a.selectionMutationDrainCond == nil {
		a.selectionMutationDrainCond = sync.NewCond(&a.selectionMutationDrainMu)
	}
	return a.selectionMutationDrainCond
}

func (a *WorkspaceCoordinator) beginSelectionMutationDrain() func() {
	a.selectionMutationDrainMu.Lock()
	a.selectionMutationPending++
	a.selectionMutationDrainCondLocked()
	a.selectionMutationDrainMu.Unlock()

	return func() {
		a.selectionMutationDrainMu.Lock()
		if a.selectionMutationPending > 0 {
			a.selectionMutationPending--
		}
		if a.selectionMutationPending == 0 {
			a.selectionMutationDrainCondLocked().Broadcast()
		}
		a.selectionMutationDrainMu.Unlock()
	}
}

func (a *WorkspaceCoordinator) waitForSelectionMutationIdle(timeout time.Duration) bool {
	if a == nil {
		return true
	}

	done := make(chan struct{})
	go func() {
		a.selectionMutationDrainMu.Lock()
		cond := a.selectionMutationDrainCondLocked()
		for a.selectionMutationPending > 0 {
			cond.Wait()
		}
		a.selectionMutationDrainMu.Unlock()
		close(done)
	}()

	if timeout <= 0 {
		<-done
		return true
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}

// isSelectionGenerationCurrent reports whether expected generation is still current.
func (a *WorkspaceCoordinator) isSelectionGenerationCurrent(expected uint64) bool {
	if a == nil {
		return false
	}
	return a.selectionGeneration.Load() == expected
}

func (a *WorkspaceCoordinator) cancelActiveSelectionGeneration() {
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

func (a *WorkspaceCoordinator) activateSelectionGeneration() context.Context {
	if a == nil {
		return context.Background()
	}

	ctx, cancel := context.WithCancel(a.CtxOrBackground())

	a.selectionGenCtxMu.Lock()
	if prev := a.selectionGenCancel; prev != nil {
		prev()
	}
	a.selectionGenCancel = cancel
	a.selectionGenCtxMu.Unlock()

	return ctx
}

// withKubeconfigStateTransition runs a short state-transition critical section.
func (a *WorkspaceCoordinator) withKubeconfigStateTransition(fn func()) {
	if a == nil || fn == nil {
		return
	}
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()
	fn()
}
