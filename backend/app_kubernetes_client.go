package backend

import "fmt"

func (a *App) initKubernetesClient() (err error) {
	a.logger.Info("Initializing Kubernetes client", "KubernetesClient")

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

	if a.refreshHTTPServer == nil || a.refreshAggregates == nil || a.refreshCtx == nil {
		if err := a.setupRefreshSubsystem(); err != nil {
			a.logger.Error(fmt.Sprintf("Failed to initialise refresh subsystem: %v", err), "Refresh")
			return fmt.Errorf("failed to initialise refresh subsystem: %w", err)
		}
	} else if err := a.updateRefreshSubsystemSelections(selections); err != nil {
		return err
	}

	a.startObjectCatalog()

	a.logger.Info(fmt.Sprintf("Successfully established Kubernetes clients for %d cluster(s)", len(selections)), "KubernetesClient")
	// Note: Global connection status tracking has been removed. Connection health
	// is now tracked per-cluster via cluster:health:* and cluster:auth:* events.

	return nil
}

func (a *App) restoreKubeconfigSelection() {
	a.selectedKubeconfigs = nil

	if a.appSettings != nil && len(a.appSettings.SelectedKubeconfigs) > 0 {
		normalized := make([]string, 0, len(a.appSettings.SelectedKubeconfigs))
		for _, selection := range a.appSettings.SelectedKubeconfigs {
			parsed, err := a.normalizeKubeconfigSelection(selection)
			if err != nil {
				continue
			}
			if err := a.validateKubeconfigSelection(parsed); err != nil {
				continue
			}
			normalized = append(normalized, parsed.String())
		}
		if len(normalized) > 0 {
			a.selectedKubeconfigs = normalized
			a.appSettings.SelectedKubeconfigs = normalized
		}
	}
}
