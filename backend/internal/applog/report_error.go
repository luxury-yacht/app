package applog

import "fmt"

// StructuredErrorLogger preserves an error value separately from the local
// application-log message so an error reporter can retain its type and chain.
type StructuredErrorLogger interface {
	ErrorWithCause(err error, message string, source ...string)
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
