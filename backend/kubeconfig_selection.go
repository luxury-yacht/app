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

// splitSelectionParts separates a selection into path/context, preserving Windows drive letters.
func splitSelectionParts(selection string) (string, string) {
	trimmed := strings.TrimSpace(selection)
	if trimmed == "" {
		return "", ""
	}

	delimiter := selectionDelimiterIndex(trimmed)
	if delimiter == -1 {
		return trimmed, ""
	}

	return trimmed[:delimiter], trimmed[delimiter+1:]
}

// selectionDelimiterIndex finds the path/context delimiter while skipping Windows drive prefixes.
func selectionDelimiterIndex(value string) int {
	if value == "" {
		return -1
	}
	start := 0
	if len(value) >= 2 && isAlpha(value[0]) && value[1] == ':' {
		if len(value) == 2 || (len(value) > 2 && value[2] != ':') {
			start = 2
		}
	}
	idx := strings.Index(value[start:], ":")
	if idx == -1 {
		return -1
	}
	return start + idx
}

func isAlpha(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
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

	path, ctx := splitSelectionParts(trimmed)
	parsed := kubeconfigSelection{Path: path, Context: ctx, Raw: selection}
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

	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
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
	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
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
		a.kubeconfigsMu.RLock()
		for _, kc := range a.availableKubeconfigs {
			if kc.Path == selection.Path && kc.Context == selection.Context {
				a.kubeconfigsMu.RUnlock()
				return ClusterMeta{
					ID:   fmt.Sprintf("%s:%s", kc.Name, kc.Context),
					Name: kc.Context,
				}
			}
		}
		a.kubeconfigsMu.RUnlock()
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

// selectedKubeconfigSelections resolves the active kubeconfig selections with context names.
func (a *App) selectedKubeconfigSelections() ([]kubeconfigSelection, error) {
	rawSelections := a.GetSelectedKubeconfigs()
	if len(rawSelections) == 0 {
		return nil, nil
	}

	selections := make([]kubeconfigSelection, 0, len(rawSelections))
	for _, raw := range rawSelections {
		parsed, err := a.normalizeKubeconfigSelection(raw)
		if err != nil {
			return nil, err
		}
		if err := a.validateKubeconfigSelection(parsed); err != nil {
			return nil, err
		}
		selections = append(selections, parsed)
	}
	return selections, nil
}
