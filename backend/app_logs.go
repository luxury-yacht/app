/*
 * backend/app_logs.go
 *
 * Handles application logging functionality.
 */

package backend

import (
	"fmt"
	"strings"
)

type AppLogsAddedEvent struct {
	Sequence uint64 `json:"sequence"`
}

func (a *App) GetAppLogs() []LogEntry {
	if a.logger == nil {
		return []LogEntry{}
	}
	return a.logger.GetEntries()
}

func (a *App) GetAppLogsSince(sequence uint64) []LogEntry {
	if a.logger == nil {
		return []LogEntry{}
	}
	return a.logger.GetEntriesSince(sequence)
}

func (a *App) ClearAppLogs() error {
	if a.logger == nil {
		return fmt.Errorf("logger not initialized")
	}

	a.logger.Clear()
	return nil
}

// LogAppLogsFromFrontend appends a log entry originating from the frontend to the application log store.
func (a *App) LogAppLogsFromFrontend(level string, message string, source string) error {
	return a.logAppLogsFromFrontend(level, message, source, "", "")
}

// LogAppLogsFromFrontendWithCluster appends a frontend log entry with structured cluster metadata.
func (a *App) LogAppLogsFromFrontendWithCluster(level string, message string, source string, clusterID string, clusterName string) error {
	return a.logAppLogsFromFrontend(level, message, source, clusterID, clusterName)
}

func (a *App) logAppLogsFromFrontend(level string, message string, source string, clusterID string, clusterName string) error {
	if a.logger == nil {
		return fmt.Errorf("logger not initialized")
	}
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return nil
	}
	origin := strings.TrimSpace(source)
	if origin == "" {
		origin = "Frontend"
	}
	clusterMeta := []string{origin, strings.TrimSpace(clusterID), strings.TrimSpace(clusterName)}

	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		a.logger.Debug(trimmed, clusterMeta...)
	case "warn", "warning":
		a.logger.Warn(trimmed, clusterMeta...)
	case "error":
		a.logger.Error(trimmed, clusterMeta...)
	default:
		a.logger.Info(trimmed, clusterMeta...)
	}

	return nil
}
