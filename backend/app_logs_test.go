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
