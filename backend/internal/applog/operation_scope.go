package applog

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
)

type operationContextKey struct{}

var operationSequence atomic.Uint64

// NextOperationID returns a process-unique identifier for one backend request
// or operation instance.
func NextOperationID(prefix string) string {
	normalized := strings.TrimSpace(prefix)
	if normalized == "" {
		normalized = "operation"
	}
	return fmt.Sprintf("%s-%d", normalized, operationSequence.Add(1))
}

// ContextWithOperationID carries a request's operation identity through code
// paths that already accept a context.Context.
func ContextWithOperationID(ctx context.Context, operationID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(operationID)
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, operationContextKey{}, id)
}

// OperationIDFromContext returns the operation identity previously attached
// with ContextWithOperationID.
func OperationIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(operationContextKey{}).(string)
	return id
}

// OperationScoped returns a logger that attaches one operation identity to all
// calls while preserving an explicitly supplied identity.
func OperationScoped(base Logger, operationID string) Logger {
	if base == nil {
		return nil
	}
	id := strings.TrimSpace(operationID)
	if id == "" {
		return base
	}
	return sourceScopedLogger{base: base, firstDefaultIndex: 3, defaults: []string{id}}
}
