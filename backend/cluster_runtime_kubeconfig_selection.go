package backend

import (
	"fmt"
	"path/filepath"
)

// normalizeKubeconfigSelection ensures a selection has an explicit context when available.
func (a *ClusterRuntimeManager) normalizeKubeconfigSelection(selection string) (kubeconfigSelection, error) {
	parsed, err := parseKubeconfigSelection(selection)
	if err != nil {
		return kubeconfigSelection{}, err
	}
	if parsed.Context != "" {
		return parsed, nil
	}

	a.discoveryMu.RLock()
	defer a.discoveryMu.RUnlock()
	for _, kc := range a.availableKubeconfigs {
		if kc.Path == parsed.Path {
			parsed.Context = kc.Context
			return parsed, nil
		}
	}

	return kubeconfigSelection{}, fmt.Errorf("kubeconfig context not found for path: %s", parsed.Path)
}

// validateKubeconfigSelection ensures the selection matches a discovered kubeconfig context.
func (a *ClusterRuntimeManager) validateKubeconfigSelection(selection kubeconfigSelection) error {
	a.discoveryMu.RLock()
	defer a.discoveryMu.RUnlock()
	for _, kc := range a.availableKubeconfigs {
		if kc.Path == selection.Path && kc.Context == selection.Context {
			return nil
		}
	}
	return fmt.Errorf("kubeconfig context not found: %s in %s", selection.Context, selection.Path)
}

// clusterMetaForSelection returns the cluster identity derived from a selection.
func (a *ClusterRuntimeManager) clusterMetaForSelection(selection kubeconfigSelection) ClusterMeta {
	if selection.Path == "" {
		return ClusterMeta{}
	}

	if selection.Context != "" {
		a.discoveryMu.RLock()
		for _, kc := range a.availableKubeconfigs {
			if kc.Path == selection.Path && kc.Context == selection.Context {
				a.discoveryMu.RUnlock()
				return ClusterMeta{
					ID:   fmt.Sprintf("%s:%s", kc.Name, kc.Context),
					Name: kc.Context,
				}
			}
		}
		a.discoveryMu.RUnlock()
	}

	filename := filepath.Base(selection.Path)
	if filename == "" && selection.Context == "" {
		return ClusterMeta{}
	}
	if selection.Context == "" {
		return ClusterMeta{ID: filename}
	}
	if filename == "" {
		return ClusterMeta{ID: selection.Context, Name: selection.Context}
	}
	return ClusterMeta{
		ID:   fmt.Sprintf("%s:%s", filename, selection.Context),
		Name: selection.Context,
	}
}
