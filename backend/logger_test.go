package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func noopLoggerTrimCapacity(t *testing.T) {
	logger := NewLogger(2)
	logger.Info("first")
	logger.Info("second")
	logger.Info("third")

	entries := logger.GetEntries()
	require.Len(t, entries, 2)
	require.Equal(t, "second", entries[0].Message)
	require.Equal(t, "third", entries[1].Message)
	require.Equal(t, 2, logger.Count())
}

func noopLoggerEventEmitter(t *testing.T) {
	logger := NewLogger(10)
	emitted := 0
	logger.SetEventEmitter(func(string) { emitted++ })
	logger.Warn("something")
	require.Equal(t, 1, emitted)
}

func noopLoggerClearAndNilSafety(t *testing.T) {
	var nilLogger *Logger
	require.NotPanics(t, func() { nilLogger.Info("noop") })
	require.Equal(t, 0, nilLogger.Count())

	logger := NewLogger(5)
	logger.Debug("entry")
	require.Equal(t, 1, logger.Count())

	logger.Clear()
	require.Equal(t, 0, logger.Count())
}

func noopLoggerDefaultMaxSizeAndUnknownLevel(t *testing.T) {
	logger := NewLogger(0) // should use default
	logger.Log(LogLevel(99), "mystery", "src")

	entries := logger.GetEntries()
	require.Len(t, entries, 1)
	require.Equal(t, "UNKNOWN", entries[0].Level)
	require.Equal(t, "src", entries[0].Source)
	require.GreaterOrEqual(t, cap(entries), 1)
}
