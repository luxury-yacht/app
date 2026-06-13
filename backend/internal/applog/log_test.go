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

func TestErrorAndInfoNilLoggerAreNoops(t *testing.T) {
	// A nil interface logger must not panic.
	Error(nil, "boom", "ResourceLoader")
	Info(nil, "ready", "NodeOperations")
}

func TestErrorPassesVariadicSourceThrough(t *testing.T) {
	base := &recordingLogger{}

	Error(base, "boom", "Refresh", "cluster-a", "Alpha")

	require.Equal(t, []string{"Refresh", "cluster-a", "Alpha"}, base.source)
}
