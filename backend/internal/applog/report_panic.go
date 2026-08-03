package applog

import "fmt"

// PanicLogger preserves a recovered panic separately from its local log text.
type PanicLogger interface {
	Panic(recovered any, message string, source ...string)
}

// ReportPanic records a recovered panic through the structured path when the
// logger supports it, falling back to the existing string-only error log.
func ReportPanic(logger Logger, recovered any, message string, source ...string) {
	if logger == nil {
		return
	}
	if structured, ok := logger.(PanicLogger); ok {
		structured.Panic(recovered, message, source...)
		return
	}
	logger.Error(fmt.Sprintf("%s: %v", message, recovered), source...)
}
