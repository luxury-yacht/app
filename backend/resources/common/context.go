package common

import (
	"context"
	"time"
)

// WithDefaultTimeout adds a timeout only when the caller has not supplied one.
// Canceling a lookup must not cancel a caller-owned deadline context.
func WithDefaultTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}
