package testsupport

// NoopLogger is a test helper that satisfies common.Logger without emitting output.
type NoopLogger struct{}

func (NoopLogger) Debug(string, ...string) {}
func (NoopLogger) Info(string, ...string)  {}
func (NoopLogger) Warn(string, ...string)  {}
func (NoopLogger) Error(string, ...string) {}
