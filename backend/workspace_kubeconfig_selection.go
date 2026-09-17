package backend

// selectedKubeconfigSelections resolves the active kubeconfig selections with context names.
func (a *WorkspaceCoordinator) selectedKubeconfigSelections() ([]kubeconfigSelection, error) {
	rawSelections := a.GetSelectedKubeconfigs()
	if len(rawSelections) == 0 {
		return nil, nil
	}

	selections := make([]kubeconfigSelection, 0, len(rawSelections))
	for _, raw := range rawSelections {
		parsed, err := a.clusterRuntime.resolveKubeconfigSelection(raw)
		if err != nil {
			return nil, err
		}
		selections = append(selections, parsed)
	}
	return selections, nil
}
