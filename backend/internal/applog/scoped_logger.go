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

func (l clusterScopedLogger) withCluster(source []string) []string {
	if len(source) >= 3 {
		return source
	}
	if len(source) >= 2 && strings.TrimSpace(source[1]) != "" {
		if len(source) == 2 && l.clusterName != "" {
			out := append([]string(nil), source...)
			return append(out, l.clusterName)
		}
		return source
	}

	out := append([]string(nil), source...)
	if len(out) == 0 {
		out = append(out, "")
	}
	if len(out) == 1 {
		return append(out, l.clusterID, l.clusterName)
	}
	out[1] = l.clusterID
	return append(out, l.clusterName)
}
