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
	require.Equal(t, uint64(1), logs[0].Sequence)
	require.Equal(t, "hello", logs[0].Message)
}

func TestGetAppLogsSinceReturnsEntriesAfterSequence(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger.Info("first")
	app.logger.Warn("second")
	app.logger.Error("third")

	logs := app.GetAppLogsSince(1)
	require.Len(t, logs, 2)
	require.Equal(t, uint64(2), logs[0].Sequence)
	require.Equal(t, "second", logs[0].Message)
	require.Equal(t, uint64(3), logs[1].Sequence)
	require.Equal(t, "third", logs[1].Message)
}

func TestGetAppLogsSinceHandlesTrimmedBuffer(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = NewLogger(2)
	app.logger.Info("first")
	app.logger.Warn("second")
	app.logger.Error("third")

	logs := app.GetAppLogsSince(0)
	require.Len(t, logs, 2)
	require.Equal(t, uint64(2), logs[0].Sequence)
	require.Equal(t, "second", logs[0].Message)
	require.Equal(t, uint64(3), logs[1].Sequence)
	require.Equal(t, "third", logs[1].Message)
}

func TestAppLogsAddedEventIncludesSequence(t *testing.T) {
	app := newTestAppWithDefaults(t)
	var eventName string
	var eventPayload AppLogsAddedEvent
	app.logger.SetEventEmitter(func(name string, args ...interface{}) {
		eventName = name
		require.Len(t, args, 1)
		var ok bool
		eventPayload, ok = args[0].(AppLogsAddedEvent)
		require.True(t, ok)
	})

	app.logger.Info("hello")

	require.Equal(t, "app-logs:added", eventName)
	require.Equal(t, uint64(1), eventPayload.Sequence)
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

	app.logger.Info("after clear")
	logs = app.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, uint64(2), logs[0].Sequence)
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
