package errorcapture

import "errors"

// telemetryHandledError marks an error whose telemetry disposition has already
// been decided by a more specific boundary. The marker changes neither the
// rendered message nor the original error chain.
type telemetryHandledError struct {
	err error
}

func (e telemetryHandledError) Error() string   { return e.err.Error() }
func (e telemetryHandledError) Unwrap() error   { return e.err }
func (telemetryHandledError) telemetryHandled() {}

type telemetryHandled interface {
	error
	telemetryHandled()
}

// MarkTelemetryHandled prevents a broader fallback boundary from reporting an
// error a second time. It is also used when a specific boundary deliberately
// suppresses telemetry, such as expected context cancellation.
func MarkTelemetryHandled(err error) error {
	if err == nil || IsTelemetryHandled(err) {
		return err
	}
	return telemetryHandledError{err: err}
}

// IsTelemetryHandled reports whether err or anything in its unwrap chain has
// already had its telemetry disposition decided.
func IsTelemetryHandled(err error) bool {
	var handled telemetryHandled
	return errors.As(err, &handled)
}
