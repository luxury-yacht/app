package backend

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ClusterMeta captures stable cluster identifiers for cache and payload scoping.
type ClusterMeta struct {
	ID   string
	Name string
}

// currentClusterMeta resolves the active cluster ID and name based on the selected kubeconfig.
func (a *App) currentClusterMeta() ClusterMeta {
	if a == nil {
		return ClusterMeta{}
	}

	// Without a selected kubeconfig path, treat the cluster as unselected.
	if strings.TrimSpace(a.selectedKubeconfig) == "" {
		return ClusterMeta{}
	}

	if a.selectedKubeconfig != "" && a.selectedContext != "" {
		for _, kc := range a.availableKubeconfigs {
			if kc.Path == a.selectedKubeconfig && kc.Context == a.selectedContext {
				return ClusterMeta{
					ID:   fmt.Sprintf("%s:%s", kc.Name, kc.Context),
					Name: kc.Context,
				}
			}
		}
	}

	filename := filepath.Base(a.selectedKubeconfig)
	if filename == "" && a.selectedContext == "" {
		return ClusterMeta{}
	}
	if a.selectedContext == "" {
		return ClusterMeta{ID: filename}
	}
	if filename == "" {
		return ClusterMeta{ID: a.selectedContext, Name: a.selectedContext}
	}
	return ClusterMeta{
		ID:   fmt.Sprintf("%s:%s", filename, a.selectedContext),
		Name: a.selectedContext,
	}
}
