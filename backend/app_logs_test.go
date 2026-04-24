package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetLogsHandlesNilLogger(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = nil

	logs := app.GetLogs()
	require.Empty(t, logs)
}

func TestGetLogsReturnsEntries(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Info("hello")

	logs := app.GetLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "hello", logs[0].Message)
}

func TestGetLogsReturnsClusterMetadata(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Warn("cluster warning", "Auth", "cluster-a", "alpha")

	logs := app.GetLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "cluster-a", logs[0].ClusterID)
	require.Equal(t, "alpha", logs[0].ClusterName)
}

func TestClearLogs(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Info("hello")

	err := app.ClearLogs()
	require.NoError(t, err)

	logs := app.GetLogs()
	require.Len(t, logs, 1)
	require.Contains(t, logs[0].Message, "Application logs cleared")
}

func TestClearLogsWhenNil(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = nil

	err := app.ClearLogs()
	require.Error(t, err)
}

func TestLogFrontendNormalizesLevelAndSource(t *testing.T) {
	app := newTestAppWithDefaults(t)

	err := app.LogFrontend("warning", "  frontend warning  ", "  UI  ")
	require.NoError(t, err)

	logs := app.GetLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "WARN", logs[0].Level)
	require.Equal(t, "frontend warning", logs[0].Message)
	require.Equal(t, "UI", logs[0].Source)
}
