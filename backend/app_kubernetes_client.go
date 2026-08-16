package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

func (a *App) initializeSelectedClustersAtStartup() (int, error) {
	snapshot, settingsErr := a.preferences.EnsureLoadedForStartup()
	if settingsErr != nil {
		return 0, settingsErr
	}
	if snapshot.Provenance == PreferencesStartupDefault {
		a.appLogs.logger.Info("Initialized app settings with defaults", logsources.App)
	} else {
		a.appLogs.logger.Debug("Application settings loaded successfully", logsources.App)
	}

	selectedCount := 0
	err := a.runSelectionMutation("startup-initialize-selected-clusters", func(*selectionMutation) error {
		a.restoreKubeconfigSelection()
		selectedCount = len(a.GetSelectedKubeconfigs())
		if selectedCount == 0 {
			return nil
		}

		a.appLogs.logger.Info(fmt.Sprintf("Connecting to %d selected cluster(s)", selectedCount), logsources.App)
		initializer := a.kubeClientInitializer
		if initializer == nil {
			initializer = a.initKubernetesClient
		}
		return initializer()
	})
	return selectedCount, err
}

func (a *App) initKubernetesClient() (err error) {
	a.appLogs.logger.Info("Initializing Kubernetes client", logsources.KubernetesClient)

	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		return err
	}
	if len(selections) == 0 {
		return fmt.Errorf("no kubeconfig selections available")
	}

	if err := a.syncClusterClientPool(selections); err != nil {
		return err
	}

	if a.refreshService.Load() == nil || a.refreshAggregates.Load() == nil || a.currentRefreshRuntimeContext() == nil {
		if err := a.setupRefreshSubsystem(); err != nil {
			a.appLogs.logger.ErrorWithCause(err, "Failed to initialise refresh subsystem", logsources.Refresh)
			return fmt.Errorf("failed to initialise refresh subsystem: %w", err)
		}
	} else if err := a.updateRefreshSubsystemSelections(selections); err != nil {
		return err
	}

	a.startObjectCatalog()

	a.appLogs.logger.Info(fmt.Sprintf("Successfully established Kubernetes clients for %d cluster(s)", len(selections)), logsources.KubernetesClient)
	// Note: Global connection status tracking has been removed. Connection health
	// is now tracked per-cluster via cluster:health:* and cluster:auth:* events.

	return nil
}

func (a *App) restoreKubeconfigSelection() {
	savedSelections := a.preferences.SelectedKubeconfigs()

	var normalized []string
	if len(savedSelections) > 0 {
		normalized = make([]string, 0, len(savedSelections))
		for _, selection := range savedSelections {
			parsed, err := a.normalizeKubeconfigSelection(selection)
			if err != nil {
				continue
			}
			if err := a.validateKubeconfigSelection(parsed); err != nil {
				continue
			}
			normalized = append(normalized, parsed.String())
		}
	}

	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(normalized)
	a.kubeconfigsMu.Unlock()
	a.replaceWorkspaceSelectionsLocked(normalized)

	if len(normalized) > 0 {
		a.preferences.SetSelectedKubeconfigsSnapshot(normalized)
	}
}
