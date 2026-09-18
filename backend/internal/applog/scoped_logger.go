package applog

import (
	"strings"

	"github.com/luxury-yacht/app/internal/sentry"
)

// Logger is the shared application-log method shape used across backend packages.
type Logger interface {
	Debug(message string, source ...string)
	Info(message string, source ...string)
	Warn(message string, source ...string)
	Error(message string, source ...string)
}

type sourceScopedLogger struct {
	base              Logger
	firstDefaultIndex int
	defaults          []string
}

// ClusterScoped returns a logger that attaches cluster metadata to source-only
// log calls. Existing explicit cluster metadata is preserved.
func ClusterScoped(base Logger, clusterID, clusterName string) Logger {
	if base == nil {
		return nil
	}
	id := strings.TrimSpace(clusterID)
	name := strings.TrimSpace(clusterName)
	if id == "" && name == "" {
		return base
	}
	return sourceScopedLogger{base: base, firstDefaultIndex: 1, defaults: []string{id, name}}
}

func (l sourceScopedLogger) Debug(message string, source ...string) {
	l.base.Debug(message, l.withDefaults(source)...)
}

func (l sourceScopedLogger) Info(message string, source ...string) {
	l.base.Info(message, l.withDefaults(source)...)
}

func (l sourceScopedLogger) Warn(message string, source ...string) {
	l.base.Warn(message, l.withDefaults(source)...)
}

func (l sourceScopedLogger) Error(message string, source ...string) {
	l.base.Error(message, l.withDefaults(source)...)
}

func (l sourceScopedLogger) ErrorWithCause(err error, message string, source ...string) {
	ReportError(l.base, err, message, l.withDefaults(source)...)
}

func (l sourceScopedLogger) ErrorWithCauseAndOperation(
	err error,
	message string,
	operation sentryreporting.Operation,
	source ...string,
) {
	ReportErrorWithOperation(l.base, err, message, operation, l.withDefaults(source)...)
}

func (l sourceScopedLogger) Panic(recovered any, message string, source ...string) {
	ReportPanic(l.base, recovered, message, l.withDefaults(source)...)
}

func (l sourceScopedLogger) withDefaults(source []string) []string {
	out := append([]string(nil), source...)
	for len(out) < l.firstDefaultIndex+len(l.defaults) {
		out = append(out, "")
	}
	for offset, value := range l.defaults {
		index := l.firstDefaultIndex + offset
		if strings.TrimSpace(out[index]) == "" {
			out[index] = value
		}
	}
	return out
}
