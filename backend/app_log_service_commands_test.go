package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/stretchr/testify/require"
)

func newTestAppLogService() *AppLogService {
	return NewAppLogService(NewLogger(100))
}

func TestGetAppLogsHandlesNilLogger(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger = nil

	logs := logsService.GetAppLogs()
	require.Empty(t, logs)
}

func TestGetAppLogsReturnsEntries(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger.Info("hello")

	logs := logsService.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, uint64(1), logs[0].Sequence)
	require.Equal(t, "hello", logs[0].Message)
}

func TestGetAppLogsSinceReturnsEntriesAfterSequence(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger.Info("first")
	logsService.logger.Warn("second")
	logsService.logger.Error("third")

	logs := logsService.GetAppLogsSince(1)
	require.Len(t, logs, 2)
	require.Equal(t, uint64(2), logs[0].Sequence)
	require.Equal(t, "second", logs[0].Message)
	require.Equal(t, uint64(3), logs[1].Sequence)
	require.Equal(t, "third", logs[1].Message)
}

func TestGetAppLogsSinceHandlesTrimmedBuffer(t *testing.T) {
	logsService := NewAppLogService(NewLogger(2))
	logsService.logger.Info("first")
	logsService.logger.Warn("second")
	logsService.logger.Error("third")

	logs := logsService.GetAppLogsSince(0)
	require.Len(t, logs, 2)
	require.Equal(t, uint64(2), logs[0].Sequence)
	require.Equal(t, "second", logs[0].Message)
	require.Equal(t, uint64(3), logs[1].Sequence)
	require.Equal(t, "third", logs[1].Message)
}

func TestAppLogsAddedEventIncludesSequence(t *testing.T) {
	logsService := newTestAppLogService()
	var eventName string
	var eventPayload AppLogsAddedEvent
	logsService.logger.SetEventEmitter(func(name string, args ...interface{}) {
		eventName = name
		require.Len(t, args, 1)
		var ok bool
		eventPayload, ok = args[0].(AppLogsAddedEvent)
		require.True(t, ok)
	})

	logsService.logger.Info("hello")

	require.Equal(t, "app-logs:added", eventName)
	require.Equal(t, uint64(1), eventPayload.Sequence)
}

func TestGetAppLogsReturnsClusterMetadata(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger.Warn("cluster warning", logsources.Auth, "cluster-a", "alpha")

	logs := logsService.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "cluster-a", logs[0].ClusterID)
	require.Equal(t, "alpha", logs[0].ClusterName)
}

func TestClearAppLogs(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger.Info("hello")

	err := logsService.ClearAppLogs()
	require.NoError(t, err)

	logs := logsService.GetAppLogs()
	require.Empty(t, logs)

	logsService.logger.Info("after clear")
	logs = logsService.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, uint64(2), logs[0].Sequence)
}

func TestClearAppLogsWhenNil(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger = nil

	err := logsService.ClearAppLogs()
	require.Error(t, err)
}

func TestLogAppLogsFromFrontendNormalizesLevelAndSource(t *testing.T) {
	logsService := newTestAppLogService()

	err := logsService.LogAppLogsFromFrontend("warning", "  frontend warning  ", "  UI  ")
	require.NoError(t, err)

	logs := logsService.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "WARN", logs[0].Level)
	require.Equal(t, "frontend warning", logs[0].Message)
	require.Equal(t, "UI", logs[0].Source)
}

func TestLogAppLogsFromFrontendWithClusterAddsMetadata(t *testing.T) {
	logsService := newTestAppLogService()

	err := logsService.LogAppLogsFromFrontendWithCluster("error", " cluster issue ", " RefreshOrchestrator ", " cluster-a ", " Alpha ")
	require.NoError(t, err)

	logs := logsService.GetAppLogs()
	require.Len(t, logs, 1)
	require.Equal(t, "ERROR", logs[0].Level)
	require.Equal(t, "cluster issue", logs[0].Message)
	require.Equal(t, "RefreshOrchestrator", logs[0].Source)
	require.Equal(t, "cluster-a", logs[0].ClusterID)
	require.Equal(t, "Alpha", logs[0].ClusterName)
}
