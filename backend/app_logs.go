package backend

import (
	"fmt"
	"strings"
)

func (a *App) GetLogs() []LogEntry {
	if a.logger == nil {
		return []LogEntry{}
	}
	return a.logger.GetEntries()
}

func (a *App) ClearLogs() error {
	if a.logger == nil {
		return fmt.Errorf("logger not initialized")
	}

	a.logger.Clear()
	a.logger.Info("Application logs cleared", "App")
	return nil
}

// LogFrontend appends a log entry originating from the frontend to the application log store.
func (a *App) LogFrontend(level string, message string, source string) error {
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

	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		a.logger.Debug(trimmed, origin)
	case "warn", "warning":
		a.logger.Warn(trimmed, origin)
	case "error":
		a.logger.Error(trimmed, origin)
	default:
		a.logger.Info(trimmed, origin)
	}

	return nil
}
