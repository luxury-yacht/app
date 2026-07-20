package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

func (a *App) initializeSelectedClustersAtStartup() (int, error) {
	selectedCount := 0
	err := a.runSelectionMutation("startup-initialize-selected-clusters", func(*selectionMutation) error {
		a.settingsMu.Lock()
		settingsErr := a.loadAppSettings()
		if settingsErr != nil {
			a.appSettings = getDefaultAppSettings()
		}
		a.settingsMu.Unlock()
		if settingsErr != nil {
			a.logger.Warn(fmt.Sprintf("Failed to load app settings: %v", settingsErr), logsources.App)
			a.logger.Info("Initialized app settings with defaults", logsources.App)
		} else {
			a.logger.Debug("Application settings loaded successfully", logsources.App)
		}

		a.restoreKubeconfigSelection()
		selectedCount = len(a.GetSelectedKubeconfigs())
		if selectedCount == 0 {
			return nil
		}

		a.logger.Info(fmt.Sprintf("Connecting to %d selected cluster(s)", selectedCount), logsources.App)
		initializer := a.kubeClientInitializer
		if initializer == nil {
			initializer = a.initKubernetesClient
		}
		return initializer()
	})
	return selectedCount, err
}

func (a *App) initKubernetesClient() (err error) {
	a.logger.Info("Initializing Kubernetes client", logsources.KubernetesClient)

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

	if a.refreshHTTPServer == nil || a.refreshAggregates.Load() == nil || a.refreshCtx == nil {
		if err := a.setupRefreshSubsystem(); err != nil {
			a.logger.Error(fmt.Sprintf("Failed to initialise refresh subsystem: %v", err), logsources.Refresh)
			return fmt.Errorf("failed to initialise refresh subsystem: %w", err)
		}
	} else if err := a.updateRefreshSubsystemSelections(selections); err != nil {
		return err
	}

	a.startObjectCatalog()

	a.logger.Info(fmt.Sprintf("Successfully established Kubernetes clients for %d cluster(s)", len(selections)), logsources.KubernetesClient)
	// Note: Global connection status tracking has been removed. Connection health
	// is now tracked per-cluster via cluster:health:* and cluster:auth:* events.

	return nil
}

func (a *App) restoreKubeconfigSelection() {
	a.settingsMu.Lock()
	var savedSelections []string
	if a.appSettings != nil {
		savedSelections = append(savedSelections, a.appSettings.SelectedKubeconfigs...)
	}
	a.settingsMu.Unlock()

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
	a.selectedKubeconfigs = append([]string(nil), normalized...)
	a.kubeconfigsMu.Unlock()

	if len(normalized) > 0 {
		a.settingsMu.Lock()
		if a.appSettings != nil {
			a.appSettings.SelectedKubeconfigs = normalized
		}
		a.settingsMu.Unlock()
	}
}
