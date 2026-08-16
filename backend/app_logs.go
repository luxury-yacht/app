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

func (s *AppLogService) GetAppLogs() []LogEntry {
	if s.logger == nil {
		return []LogEntry{}
	}
	return s.logger.GetEntries()
}

func (s *AppLogService) GetAppLogsSince(sequence uint64) []LogEntry {
	if s.logger == nil {
		return []LogEntry{}
	}
	return s.logger.GetEntriesSince(sequence)
}

func (s *AppLogService) ClearAppLogs() error {
	if s.logger == nil {
		return fmt.Errorf("logger not initialized")
	}

	s.logger.Clear()
	return nil
}

// LogAppLogsFromFrontend appends a log entry originating from the frontend to the application log store.
func (s *AppLogService) LogAppLogsFromFrontend(level, message, source string) error {
	return s.logAppLogsFromFrontend(level, message, source, "", "")
}

// LogAppLogsFromFrontendWithCluster appends a frontend log entry with structured cluster metadata.
func (s *AppLogService) LogAppLogsFromFrontendWithCluster(level, message, source, clusterID, clusterName string) error {
	return s.logAppLogsFromFrontend(level, message, source, clusterID, clusterName)
}

func (s *AppLogService) logAppLogsFromFrontend(level, message, source, clusterID, clusterName string) error {
	if s.logger == nil {
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
		s.logger.Debug(trimmed, clusterMeta...)
	case "warn", "warning":
		s.logger.Warn(trimmed, clusterMeta...)
	case "error":
		s.logger.Error(trimmed, clusterMeta...)
	default:
		s.logger.Info(trimmed, clusterMeta...)
	}

	return nil
}
