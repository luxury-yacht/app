package panelwindow

import "fmt"

// TransferClusterView carries exactly the source view's docked tabs. Floating
// groups and another app view's navigation are independent of this handoff.
func (d *WorkspaceDirectory) TransferClusterView(source, target, clusterID string, groups []WorkspaceGroup) error {
	if source == "" || target == "" || source == target || clusterID == "" {
		return fmt.Errorf("cluster transfer requires distinct windows and cluster identity")
	}
	next, err := panelsFromGroups(target, PanelLocationDocked, groups)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.validateClusterViewTransferLocked(source, clusterID, next); err != nil {
		return err
	}
	d.appendPlacementsLocked(target, next)
	for key, panel := range next {
		d.panels[key] = panel
		delete(d.unpublished, key)
	}
	d.revision++
	return nil
}

func (d *WorkspaceDirectory) validateClusterViewTransferLocked(source, clusterID string, next map[workspacePanelKey]WorkspacePanel) error {
	for key, panel := range next {
		current, exists := d.panels[key]
		if key.clusterID != clusterID || !exists || current.Tab != panel.Tab || current.Location.Kind != PanelLocationDocked || current.Location.WindowName != source {
			return fmt.Errorf("cluster view transfer source is stale")
		}
	}
	for key, panel := range d.panels {
		if key.clusterID != clusterID || panel.Location.WindowName != source || panel.Location.Kind != PanelLocationDocked {
			continue
		}
		if _, exists := next[key]; !exists {
			return fmt.Errorf("cluster view transfer omits a docked panel")
		}
	}
	return nil
}

func (d *WorkspaceDirectory) appendPlacementsLocked(target string, next map[workspacePanelKey]WorkspacePanel) {
	offsets := make(map[workspacePanelKey]int)
	activeGroups := make(map[workspacePanelKey]bool)
	for key, panel := range next {
		if panel.Location.Active {
			activeGroups[workspacePanelKey{key.clusterID, panel.Location.GroupID}] = true
		}
	}
	for key, panel := range d.panels {
		if _, moving := next[key]; moving {
			continue
		}
		if panel.Location.WindowName != target || panel.Location.Kind != PanelLocationDocked {
			continue
		}
		groupKey := workspacePanelKey{key.clusterID, panel.Location.GroupID}
		offsets[groupKey] = max(offsets[groupKey], panel.Location.Index+1)
		if activeGroups[groupKey] {
			panel.Location.Active = false
			d.panels[key] = panel
		}
	}
	for key, panel := range next {
		panel.Location.Index += offsets[workspacePanelKey{key.clusterID, panel.Location.GroupID}]
		next[key] = panel
	}
}
