package applog

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestErrorForwardsMessageAndSource(t *testing.T) {
	base := &recordingLogger{}

	Error(base, "boom", "ResourceLoader")

	require.Equal(t, "error", base.method)
	require.Equal(t, "boom", base.message)
	require.Equal(t, []string{"ResourceLoader"}, base.source)
}

func TestInfoForwardsMessageAndSource(t *testing.T) {
	base := &recordingLogger{}

	Info(base, "ready", "NodeOperations")

	require.Equal(t, "info", base.method)
	require.Equal(t, "ready", base.message)
	require.Equal(t, []string{"NodeOperations"}, base.source)
}

func TestDebugForwardsMessageAndSource(t *testing.T) {
	base := &recordingLogger{}

	Debug(base, "trace", "Catalog")

	require.Equal(t, "debug", base.method)
	require.Equal(t, "trace", base.message)
	require.Equal(t, []string{"Catalog"}, base.source)
}

func TestWarnForwardsMessageAndSource(t *testing.T) {
	base := &recordingLogger{}

	Warn(base, "degraded", "Refresh")

	require.Equal(t, "warn", base.method)
	require.Equal(t, "degraded", base.message)
	require.Equal(t, []string{"Refresh"}, base.source)
}

func TestNilLoggerAreNoops(t *testing.T) {
	// A nil interface logger must not panic at any level.
	Error(nil, "boom", "ResourceLoader")
	Info(nil, "ready", "NodeOperations")
	Debug(nil, "trace", "Catalog")
	Warn(nil, "degraded", "Refresh")
}

func TestErrorPassesVariadicSourceThrough(t *testing.T) {
	base := &recordingLogger{}

	Error(base, "boom", "Refresh", "cluster-a", "Alpha")

	require.Equal(t, []string{"Refresh", "cluster-a", "Alpha"}, base.source)
}
