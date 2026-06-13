package applog

// Error logs an error message under the given source(s), guarding against a nil
// logger. It is a nil-safe pass-through to Logger.Error so callers across the
// app can drop the repetitive `if logger != nil` guard.
func Error(l Logger, message string, source ...string) {
	if l != nil {
		l.Error(message, source...)
	}
}

// Info logs an info message under the given source(s), guarding against a nil
// logger. See Error.
func Info(l Logger, message string, source ...string) {
	if l != nil {
		l.Info(message, source...)
	}
}
