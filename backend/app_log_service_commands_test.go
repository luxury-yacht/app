package backend

import (
	"fmt"
	"sync"
	"testing"
	"time"

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

// Like container log lines, writes reach the panel in batches: a burst sends one
// app-logs:added carrying the newest sequence, and the panel reads every entry
// after the last one it has.
func TestAppLogsAddedEventsBatchBurstsOfWrites(t *testing.T) {
	logsService := newTestAppLogService()
	logsService.logger.addedEvents.window = 20 * time.Millisecond
	var mu sync.Mutex
	var names []string
	var sequences []uint64
	logsService.logger.SetEventEmitter(func(name string, args ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		names = append(names, name)
		if len(args) == 1 {
			if payload, ok := args[0].(AppLogsAddedEvent); ok {
				sequences = append(sequences, payload.Sequence)
			}
		}
	})
	sent := func() []uint64 {
		mu.Lock()
		defer mu.Unlock()
		return append([]uint64(nil), sequences...)
	}

	for i := range 50 {
		logsService.logger.Info(fmt.Sprintf("line %d", i))
	}
	require.Eventually(t, func() bool { return len(sent()) > 0 }, time.Second, time.Millisecond)
	time.Sleep(60 * time.Millisecond)
	require.Equal(t, []uint64{50}, sent())

	logsService.logger.Info("later")
	require.Eventually(t, func() bool { return len(sent()) == 2 }, time.Second, time.Millisecond)
	require.Equal(t, []uint64{50, 51}, sent())
	mu.Lock()
	require.Equal(t, []string{"app-logs:added", "app-logs:added"}, names)
	mu.Unlock()
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
	for _, test := range []struct{ input, want string }{
		{"debug", "DEBUG"}, {"info", "INFO"}, {"warn", "WARN"},
		{" WARNING ", "WARN"}, {"ERROR", "ERROR"}, {"unknown", "INFO"},
	} {
		t.Run(test.input, func(t *testing.T) {
			logsService := newTestAppLogService()
			err := logsService.LogAppLogsFromFrontend(test.input, "  frontend message  ", "  UI  ")
			require.NoError(t, err)
			logs := logsService.GetAppLogs()
			require.Len(t, logs, 1)
			require.Equal(t, test.want, logs[0].Level)
			require.Equal(t, "frontend message", logs[0].Message)
			require.Equal(t, "UI", logs[0].Source)
		})
	}
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
