package backend

import (
	"fmt"
	"path/filepath"
	"strings"
)

// kubeconfigSelection captures a parsed kubeconfig path/context selection.
type kubeconfigSelection struct {
	Path    string
	Context string
	Raw     string
}

// String renders the selection in "path:context" form when a context is present.
func (s kubeconfigSelection) String() string {
	if s.Context == "" {
		return s.Path
	}
	return fmt.Sprintf("%s:%s", s.Path, s.Context)
}

// parseKubeconfigSelection splits "path:context" into its components.
func parseKubeconfigSelection(selection string) (kubeconfigSelection, error) {
	trimmed := strings.TrimSpace(selection)
	if trimmed == "" {
		return kubeconfigSelection{}, fmt.Errorf("kubeconfig selection is empty")
	}

	parts := strings.SplitN(trimmed, ":", 2)
	parsed := kubeconfigSelection{Path: parts[0], Raw: selection}
	if len(parts) == 2 {
		parsed.Context = parts[1]
	}
	if strings.TrimSpace(parsed.Path) == "" {
		return kubeconfigSelection{}, fmt.Errorf("kubeconfig selection missing path")
	}
	return parsed, nil
}

// normalizeKubeconfigSelection ensures a selection has an explicit context when available.
func (a *App) normalizeKubeconfigSelection(selection string) (kubeconfigSelection, error) {
	parsed, err := parseKubeconfigSelection(selection)
	if err != nil {
		return kubeconfigSelection{}, err
	}
	if parsed.Context != "" {
		return parsed, nil
	}

	for _, kc := range a.availableKubeconfigs {
		if kc.Path == parsed.Path {
			parsed.Context = kc.Context
			return parsed, nil
		}
	}

	return kubeconfigSelection{}, fmt.Errorf("kubeconfig context not found for path: %s", parsed.Path)
}

// validateKubeconfigSelection ensures the selection matches a discovered kubeconfig context.
func (a *App) validateKubeconfigSelection(selection kubeconfigSelection) error {
	for _, kc := range a.availableKubeconfigs {
		if kc.Path == selection.Path && kc.Context == selection.Context {
			return nil
		}
	}
	return fmt.Errorf("kubeconfig context not found: %s in %s", selection.Context, selection.Path)
}

// clusterMetaForSelection returns the cluster identity derived from a selection.
func (a *App) clusterMetaForSelection(selection kubeconfigSelection) ClusterMeta {
	if selection.Path == "" {
		return ClusterMeta{}
	}

	if selection.Context != "" {
		for _, kc := range a.availableKubeconfigs {
			if kc.Path == selection.Path && kc.Context == selection.Context {
				return ClusterMeta{
					ID:   fmt.Sprintf("%s:%s", kc.Name, kc.Context),
					Name: kc.Context,
				}
			}
		}
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
