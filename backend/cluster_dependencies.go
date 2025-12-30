package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
)

// resourceDependenciesForClusterID resolves dependencies for a specific cluster selection.
func (a *App) resourceDependenciesForClusterID(clusterID string) (common.Dependencies, bool) {
	if a == nil || strings.TrimSpace(clusterID) == "" {
		return common.Dependencies{}, false
	}

	clients := a.clusterClientsForID(clusterID)
	if clients == nil {
		return common.Dependencies{}, false
	}

	selection := kubeconfigSelection{
		Path:    clients.kubeconfigPath,
		Context: clients.kubeconfigContext,
	}

	return a.resourceDependenciesForSelection(selection, clients, clusterID), true
}

// resolveClusterDependencies ensures callers operate on a specific active cluster.
func (a *App) resolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	trimmed := strings.TrimSpace(clusterID)
	if trimmed == "" {
		return common.Dependencies{}, "", fmt.Errorf("cluster id is required")
	}

	deps, ok := a.resourceDependenciesForClusterID(trimmed)
	if !ok {
		return common.Dependencies{}, "", fmt.Errorf("cluster %s not active", trimmed)
	}

	return deps, trimmed, nil
}
