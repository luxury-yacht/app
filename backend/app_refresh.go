package backend

import "fmt"

func (a *App) GetRefreshBaseURL() (string, error) {
	if a.refreshBaseURL == "" {
		return "", fmt.Errorf("refresh subsystem not initialised")
	}
	return a.refreshBaseURL, nil
}
