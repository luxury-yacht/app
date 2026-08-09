// Package lifecycle adapts an owned cancellation signal into an operation context.
package lifecycle

import (
	"context"
	"time"
)

// Context returns a context whose lifetime is controlled by done.
// Lifecycle owners can retain the cancellation signal without retaining a
// request context or its values.
func Context(done <-chan struct{}) context.Context {
	if done == nil {
		return context.Background()
	}
	return cancellationContext{done: done}
}

type cancellationContext struct {
	done <-chan struct{}
}

func (c cancellationContext) Deadline() (time.Time, bool) {
	return time.Time{}, false
}

func (c cancellationContext) Done() <-chan struct{} {
	return c.done
}

func (c cancellationContext) Err() error {
	select {
	case <-c.done:
		return context.Canceled
	default:
		return nil
	}
}

func (c cancellationContext) Value(any) any {
	return nil
}
