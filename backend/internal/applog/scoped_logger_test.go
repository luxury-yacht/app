package applog

import (
	"testing"

	"github.com/stretchr/testify/require"
)

type recordingLogger struct {
	method  string
	message string
	source  []string
}

func (l *recordingLogger) Debug(message string, source ...string) {
	l.method = "debug"
	l.message = message
	l.source = append([]string(nil), source...)
}

func (l *recordingLogger) Info(message string, source ...string) {
	l.method = "info"
	l.message = message
	l.source = append([]string(nil), source...)
}

func (l *recordingLogger) Warn(message string, source ...string) {
	l.method = "warn"
	l.message = message
	l.source = append([]string(nil), source...)
}

func (l *recordingLogger) Error(message string, source ...string) {
	l.method = "error"
	l.message = message
	l.source = append([]string(nil), source...)
}

func TestClusterScopedAddsClusterMetadataToSourceOnlyLogs(t *testing.T) {
	base := &recordingLogger{}
	logger := ClusterScoped(base, "cluster-a", "Alpha")

	logger.Warn("buffer full", "ObjectCatalog")

	require.Equal(t, "warn", base.method)
	require.Equal(t, "buffer full", base.message)
	require.Equal(t, []string{"ObjectCatalog", "cluster-a", "Alpha"}, base.source)
}

func TestClusterScopedPreservesExplicitClusterMetadata(t *testing.T) {
	base := &recordingLogger{}
	logger := ClusterScoped(base, "cluster-a", "Alpha")

	logger.Info("ready", "Refresh", "cluster-b", "Bravo")

	require.Equal(t, []string{"Refresh", "cluster-b", "Bravo"}, base.source)
}
