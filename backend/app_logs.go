package backend

import "fmt"

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
