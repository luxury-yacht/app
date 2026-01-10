/*
 * backend/internal/parallel/parallel.go
 *
 * Utilities for parallel execution of tasks with concurrency control.
 */

package parallel

import (
	"context"

	"golang.org/x/sync/errgroup"
)

// RunLimited executes the supplied tasks with an optional concurrency limit.
// Tasks receive a context that is cancelled if any sibling returns an error.
func RunLimited(ctx context.Context, limit int, tasks ...func(context.Context) error) error {
	if len(tasks) == 0 {
		return nil
	}

	group, ctx := errgroup.WithContext(ctx)
	if limit > 0 {
		group.SetLimit(limit)
	}

	for _, task := range tasks {
		task := task
		if task == nil {
			continue
		}
		group.Go(func() error {
			return task(ctx)
		})
	}

	return group.Wait()
}

// ForEach runs fn for every item, honouring the provided concurrency limit.
func ForEach[T any](ctx context.Context, items []T, limit int, fn func(context.Context, T) error) error {
	// Return early if no function or items are provided.
	if fn == nil || len(items) == 0 {
		return nil
	}

	// Create an errgroup with the provided context.
	group, ctx := errgroup.WithContext(ctx)
	if limit > 0 {
		group.SetLimit(limit)
	}

	// Launch a goroutine for each item.
	for _, item := range items {
		item := item
		group.Go(func() error {
			return fn(ctx, item)
		})
	}

	return group.Wait()
}

// CopyToPointers returns a slice of pointers referencing the original slice elements.
func CopyToPointers[T any](items []T) []*T {
	result := make([]*T, 0, len(items))
	for i := range items {
		result = append(result, &items[i])
	}
	return result
}
