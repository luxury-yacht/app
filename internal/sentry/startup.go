package sentryreporting

import (
	"strings"
)

// ReportPanic must be deferred directly; it captures a panic before rethrowing it.
func ReportPanic(reporter Reporter) {
	if recovered := recover(); recovered != nil {
		reporter.CapturePanic(recovered, Context{Source: "Process"})
		panic(recovered)
	}
}

// ReportRunError records a Wails application failure.
func ReportRunError(reporter Reporter, err error) {
	if err != nil {
		reporter.CaptureException(err, Context{Source: "Wails"})
	}
}

func defaultSentryRelease(version string) string {
	version = strings.TrimSpace(version)
	if version == "" || version == "dev" {
		return ""
	}
	return "luxury-yacht@" + version
}

// NewStartupReporter keeps reporting disabled until persisted consent is loaded.
func NewStartupReporter(enabled bool, defaultDSN, version string) (Reporter, error) {
	if !enabled {
		return New(Config{})
	}
	return NewDisabled(ConfigFromEnvironment(
		defaultDSN,
		defaultSentryRelease(version),
		"production",
	))
}
