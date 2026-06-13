package applog

// Noop is a Logger that discards every message. Use it as a non-nil default
// (e.g. when a constructor receives a nil logger) so downstream code can call
// the logger directly without repeating `if logger != nil` guards.
var Noop Logger = noopLogger{}

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}
