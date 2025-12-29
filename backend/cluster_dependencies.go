package backend

import (
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
