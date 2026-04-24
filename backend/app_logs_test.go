package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetAppLogsHandlesNilLogger(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = nil

	logs := app.GetAppLogs()
	require.Empty(t, logs)
}

func TestGetAppLogsReturnsEntries(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Info("hello")

	logs := app.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "hello", logs[0].Message)
}

func TestGetAppLogsReturnsClusterMetadata(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Warn("cluster warning", "Auth", "cluster-a", "alpha")

	logs := app.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "cluster-a", logs[0].ClusterID)
	require.Equal(t, "alpha", logs[0].ClusterName)
}

func TestClearAppLogs(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Info("hello")

	err := app.ClearAppLogs()
	require.NoError(t, err)

	logs := app.GetAppLogs()
	require.Empty(t, logs)
}

func TestClearAppLogsWhenNil(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = nil

	err := app.ClearAppLogs()
	require.Error(t, err)
}

func TestLogAppLogsFromFrontendNormalizesLevelAndSource(t *testing.T) {
	app := newTestAppWithDefaults(t)

	err := app.LogAppLogsFromFrontend("warning", "  frontend warning  ", "  UI  ")
	require.NoError(t, err)

	logs := app.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "WARN", logs[0].Level)
	require.Equal(t, "frontend warning", logs[0].Message)
	require.Equal(t, "UI", logs[0].Source)
}
