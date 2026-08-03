package applog

import "strings"

// Logger is the shared application-log method shape used across backend packages.
type Logger interface {
	Debug(message string, source ...string)
	Info(message string, source ...string)
	Warn(message string, source ...string)
	Error(message string, source ...string)
}

type clusterScopedLogger struct {
	base        Logger
	clusterID   string
	clusterName string
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
	return clusterScopedLogger{base: base, clusterID: id, clusterName: name}
}

func (l clusterScopedLogger) Debug(message string, source ...string) {
	l.base.Debug(message, l.withCluster(source)...)
}

func (l clusterScopedLogger) Info(message string, source ...string) {
	l.base.Info(message, l.withCluster(source)...)
}

func (l clusterScopedLogger) Warn(message string, source ...string) {
	l.base.Warn(message, l.withCluster(source)...)
}

func (l clusterScopedLogger) Error(message string, source ...string) {
	l.base.Error(message, l.withCluster(source)...)
}

func (l clusterScopedLogger) ErrorWithCause(err error, message string, source ...string) {
	ReportError(l.base, err, message, l.withCluster(source)...)
}

func (l clusterScopedLogger) Panic(recovered any, message string, source ...string) {
	ReportPanic(l.base, recovered, message, l.withCluster(source)...)
}

func (l clusterScopedLogger) withCluster(source []string) []string {
	out := append([]string(nil), source...)
	for len(out) < 3 {
		out = append(out, "")
	}
	if strings.TrimSpace(out[1]) == "" {
		out[1] = l.clusterID
	}
	if strings.TrimSpace(out[2]) == "" {
		out[2] = l.clusterName
	}
	return out
}
