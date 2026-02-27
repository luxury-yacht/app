package backend

import (
	"fmt"
	"time"
)

// selectionMutation carries metadata for a coordinated cluster mutation operation.
// Phase 1 keeps execution serialized while plumbing generation-aware boundaries.
type selectionMutation struct {
	generation uint64
	reason     string
	startedAt  time.Time
}

// runSelectionMutation serializes a cluster-selection/runtime mutation path,
// increments selection generation, and executes the mutation callback.
func (a *App) runSelectionMutation(reason string, fn func(selectionMutation) error) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	if fn == nil {
		return fmt.Errorf("selection mutation callback is nil")
	}

	// Keep coordinated mutations sequential in Phase 1, but do not hold
	// kubeconfigChangeMu across heavy work.
	a.selectionMutationMu.Lock()
	defer a.selectionMutationMu.Unlock()

	var mutation selectionMutation
	a.withKubeconfigStateTransition(func() {
		mutation = selectionMutation{
			generation: a.selectionGeneration.Add(1),
			reason:     reason,
			startedAt:  time.Now(),
		}
	})

	if a.logger != nil {
		a.logger.Debug(
			fmt.Sprintf("Selection mutation start (reason=%s generation=%d)", mutation.reason, mutation.generation),
			"KubeconfigManager",
		)
	}

	return fn(mutation)
}

// runSelectionMutationAsync executes a coordinated mutation asynchronously.
// Errors are logged since callers are typically event/recovery callbacks.
func (a *App) runSelectionMutationAsync(reason string, fn func(selectionMutation) error) {
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

// withKubeconfigStateTransition runs a short state-transition critical section.
func (a *App) withKubeconfigStateTransition(fn func()) {
	if a == nil || fn == nil {
		return
	}
	a.kubeconfigChangeMu.Lock()
	defer a.kubeconfigChangeMu.Unlock()
	fn()
}
