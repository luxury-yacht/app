package backend

import (
	"errors"
)

func (a *WorkspaceCoordinator) setupRefreshSubsystem() error {
	if !a.runtimeAvailable() {
		return errors.New("application context not initialised")
	}
	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		return err
	}
	if err := a.syncClusterClientPool(selections); err != nil {
		return err
	}
	return a.refresh.setupRefreshSubsystemForSelections(selections)
}
