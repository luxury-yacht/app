package applog

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/luxury-yacht/app/internal/sentry"
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

type operationScopedLogger struct {
	base        Logger
	operationID string
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
	return operationScopedLogger{base: base, operationID: id}
}

func (l operationScopedLogger) Debug(message string, source ...string) {
	l.base.Debug(message, l.withOperation(source)...)
}

func (l operationScopedLogger) Info(message string, source ...string) {
	l.base.Info(message, l.withOperation(source)...)
}

func (l operationScopedLogger) Warn(message string, source ...string) {
	l.base.Warn(message, l.withOperation(source)...)
}

func (l operationScopedLogger) Error(message string, source ...string) {
	l.base.Error(message, l.withOperation(source)...)
}

func (l operationScopedLogger) ErrorWithCause(err error, message string, source ...string) {
	ReportError(l.base, err, message, l.withOperation(source)...)
}

func (l operationScopedLogger) ErrorWithCauseAndOperation(
	err error,
	message string,
	operation sentryreporting.Operation,
	source ...string,
) {
	ReportErrorWithOperation(l.base, err, message, operation, l.withOperation(source)...)
}

func (l operationScopedLogger) Panic(recovered any, message string, source ...string) {
	ReportPanic(l.base, recovered, message, l.withOperation(source)...)
}

func (l operationScopedLogger) withOperation(source []string) []string {
	out := append([]string(nil), source...)
	for len(out) < 4 {
		out = append(out, "")
	}
	if strings.TrimSpace(out[3]) == "" {
		out[3] = l.operationID
	}
	return out
}
