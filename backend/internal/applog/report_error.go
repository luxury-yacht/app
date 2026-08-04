package applog

import (
	"fmt"

	"github.com/luxury-yacht/app/internal/sentryreporting"
)

// StructuredErrorLogger preserves an error value separately from the local
// application-log message so an error reporter can retain its type and chain.
type StructuredErrorLogger interface {
	ErrorWithCause(err error, message string, source ...string)
}

// StructuredOperationErrorLogger accepts only the closed telemetry operation
// schema. Human-readable log messages remain separate and local.
type StructuredOperationErrorLogger interface {
	ErrorWithCauseAndOperation(err error, message string, operation sentryreporting.Operation, source ...string)
}

// ReportError records a human-readable local message while preserving err for
// loggers that support structured error reporting. Lightweight loggers keep
// the existing string-only behavior.
func ReportError(logger Logger, err error, message string, source ...string) {
	if logger == nil {
		return
	}
	if structured, ok := logger.(StructuredErrorLogger); ok {
		structured.ErrorWithCause(err, message, source...)
		return
	}
	logger.Error(fmt.Sprintf("%s: %v", message, err), source...)
}

// ReportErrorWithOperation preserves a privacy-reviewed operation when the
// logger supports it. Other loggers still receive the original error through
// the existing structured path.
func ReportErrorWithOperation(
	logger Logger,
	err error,
	message string,
	operation sentryreporting.Operation,
	source ...string,
) {
	if logger == nil {
		return
	}
	if structured, ok := logger.(StructuredOperationErrorLogger); ok {
		structured.ErrorWithCauseAndOperation(err, message, operation, source...)
		return
	}
	ReportError(logger, err, message, source...)
}
