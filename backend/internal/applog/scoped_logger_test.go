package applog

import (
	"errors"
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

func TestClusterScopedReturnsBaseWithoutClusterMetadata(t *testing.T) {
	base := &recordingLogger{}

	require.Same(t, base, ClusterScoped(base, " ", " "))
	require.Nil(t, ClusterScoped(nil, "cluster-a", "Alpha"))
}

func TestClusterScopedForwardsDebugAndError(t *testing.T) {
	base := &recordingLogger{}
	logger := ClusterScoped(base, "cluster-a", "Alpha")

	logger.Debug("trace")
	require.Equal(t, "debug", base.method)
	require.Equal(t, []string{"", "cluster-a", "Alpha"}, base.source)

	logger.Error("boom", "Metrics", "cluster-b")
	require.Equal(t, "error", base.method)
	require.Equal(t, []string{"Metrics", "cluster-b", "Alpha"}, base.source)
}

func TestClusterScopedPreservesStructuredFailureAndClusterMetadata(t *testing.T) {
	base := &recordingStructuredLogger{}
	logger := ClusterScoped(base, "cluster-a", "Alpha")
	cause := errors.New("forbidden")

	ReportError(logger, cause, "load pods", "Refresh")

	require.ErrorIs(t, base.cause, cause)
	require.Equal(t, "load pods", base.message)
	require.Equal(t, []string{"Refresh", "cluster-a", "Alpha"}, base.source)
}

func TestClusterScopedPreservesPanicAndClusterMetadata(t *testing.T) {
	base := &recordingStructuredLogger{}
	logger := ClusterScoped(base, "cluster-a", "Alpha")

	ReportPanic(logger, "boom", "stream container logs", "ContainerLogs")

	require.Equal(t, "boom", base.recovered)
	require.Equal(t, "stream container logs", base.message)
	require.Equal(t, []string{"ContainerLogs", "cluster-a", "Alpha"}, base.source)
}
