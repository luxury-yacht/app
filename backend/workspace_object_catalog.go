package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// catalogTargets returns the ordered set of cluster selections to catalogue.
func (a *WorkspaceCoordinator) catalogTargets() []catalogTarget {
	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		selections = nil
	}

	if len(selections) == 0 {
		return nil
	}

	targets := make([]catalogTarget, 0, len(selections))
	for _, selection := range selections {
		meta := a.clusterMetaForSelection(selection)
		if meta.ID == "" {
			continue
		}
		targets = append(targets, catalogTarget{selection: selection, meta: meta})
	}
	return targets
}

func (a *WorkspaceCoordinator) startObjectCatalog() {
	if a == nil || !a.runtimeAvailable() {
		return
	}

	a.RefreshCoordinator.stopObjectCatalog()

	targets := a.catalogTargets()
	if len(targets) == 0 {
		return
	}

	for _, target := range targets {
		if err := a.RefreshCoordinator.startObjectCatalogForTarget(target); err != nil {
			a.appLogs.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", target.meta.ID, err), logsources.ObjectCatalog, target.meta.ID, target.meta.Name)
			continue
		}
	}
}
