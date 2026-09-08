package appwindow

import (
	"fmt"
	"slices"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (r *Registry) windowHasCluster(windowName, clusterID string) bool {
	if r.lifecycle != nil && r.lifecycle.Contains(windowName) {
		return r.backend != nil && slices.Contains(r.backend.WindowClusterIDs(windowName), clusterID)
	}
	if r.panels == nil {
		return false
	}
	descriptor, err := r.panels.Descriptor(windowName)
	return err == nil && descriptor.ClusterID == clusterID
}

func (r *Registry) validateGroupSource(windowName string, snapshot panelwindow.GroupSnapshot) error {
	if err := panelwindow.ValidateGroupSnapshot(snapshot); err != nil {
		return err
	}
	panels := make(map[string]panelwindow.WorkspacePanel)
	for _, panel := range r.workspace.Snapshot(snapshot.ClusterID).Panels {
		panels[panel.Tab.PanelID] = panel
	}
	for _, tab := range snapshot.Tabs {
		panel, exists := panels[tab.PanelID]
		if !exists || panel.Tab != tab || panel.Location.WindowName != windowName {
			return fmt.Errorf("panel group source is stale")
		}
	}
	return nil
}

type workspaceWindowEvent struct {
	name    string
	payload any
}

func (r *Registry) AcknowledgePanelWorkspaceReady(windowName string) error {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if !r.lifecycle.Contains(windowName) {
		return fmt.Errorf("app window %q is not live", windowName)
	}
	r.closeMu.Lock()
	if r.panelWorkspaceReady == nil {
		r.panelWorkspaceReady = make(map[string]struct{})
	}
	r.panelWorkspaceReady[windowName] = struct{}{}
	queued := r.queuedWorkspaceEvents[windowName]
	delete(r.queuedWorkspaceEvents, windowName)
	r.closeMu.Unlock()
	for _, event := range queued {
		if insertion, ok := event.payload.(panelwindow.TabTransferInsertRequestedEvent); ok && !r.panelTabInsertionPending(insertion.Request) {
			continue
		}
		if !r.emitWindowEvent(windowName, event.name, event.payload) {
			return fmt.Errorf("app window %q is not available", windowName)
		}
	}
	return nil
}

func (r *Registry) queueWorkspaceEvent(windowName, name string, payload any) bool {
	if !r.lifecycle.Contains(windowName) {
		return false
	}
	r.closeMu.Lock()
	_, ready := r.panelWorkspaceReady[windowName]
	if !ready {
		if r.queuedWorkspaceEvents == nil {
			r.queuedWorkspaceEvents = make(map[string][]workspaceWindowEvent)
		}
		r.queuedWorkspaceEvents[windowName] = append(r.queuedWorkspaceEvents[windowName], workspaceWindowEvent{name, payload})
	}
	r.closeMu.Unlock()
	return !ready || r.emitWindowEvent(windowName, name, payload)
}

func (r *Registry) appWindowForCluster(clusterID, source string) (string, error) {
	mostRecent := r.lifecycle.MostRecent()
	if r.windowHasCluster(mostRecent, clusterID) {
		return mostRecent, nil
	}
	for _, name := range r.lifecycle.Names() {
		if r.windowHasCluster(name, clusterID) {
			return name, nil
		}
	}
	transfer := &clusterViewTransfer{event: panelwindow.ClusterTabTransferEvent{Request: panelwindow.ClusterTabTransferRequest{SourceWindowName: source, ClusterID: clusterID}}}
	if _, err := r.stageClusterTransferTarget(transfer); err != nil {
		return "", err
	}
	return transfer.event.Request.TargetWindowName, nil
}

func (r *Registry) abortReadyPanelWindow(descriptor PanelWindowDescriptor) error {
	r.authorizeClose(descriptor.WindowName)
	if !r.closeWindow(descriptor.WindowName) {
		r.consumeAuthorizedClose(descriptor.WindowName)
	}
	r.panels.Remove(descriptor.WindowName)
	r.failPanelTabTransfer(descriptor.Snapshot.TransferID, "new panel target failed before readiness")
	cleanup := r.releaseNativePanelReference(descriptor.WindowName)
	r.emitPanelClosed(descriptor)
	return cleanup
}

func (r *Registry) restoreFailedPanelOpen(targetWindow string, previous []panelwindow.WorkspacePanel) {
	for i := range previous {
		panel := &previous[i]
		if panel.Location.Kind == panelwindow.PanelLocationDocked && !r.windowHasCluster(panel.Location.WindowName, panel.Tab.ObjectRef.ClusterID) {
			panel.Location.Kind = panelwindow.PanelLocationRetained
			panel.Location.WindowName = ""
		}
	}
	r.workspace.RestoreTransferredPanels(targetWindow, previous)
}

func (r *Registry) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	if !r.windowHasCluster(windowName, clusterID) {
		return panelwindow.WorkspaceSnapshot{}, fmt.Errorf("window %q does not display cluster %q", windowName, clusterID)
	}
	return r.workspace.Snapshot(clusterID), nil
}

func (r *Registry) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if !r.windowHasCluster(windowName, tab.ObjectRef.ClusterID) {
		return panelwindow.PanelOpenResult{}, fmt.Errorf("window %q does not display cluster %q", windowName, tab.ObjectRef.ClusterID)
	}
	if err := r.retainPanelWorkspace(tab.ObjectRef.ClusterID); err != nil {
		return panelwindow.PanelOpenResult{}, err
	}
	location := panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: windowName, GroupID: "right", Active: true}
	if descriptor, err := r.panels.Descriptor(windowName); err == nil {
		location.Kind = panelwindow.PanelLocationWindow
		location.GroupID = descriptor.GroupID
	}
	panel, render, err := r.workspace.Open(tab, location)
	if err != nil {
		r.releaseUnusedPanelWorkspace(tab.ObjectRef.ClusterID)
		return panelwindow.PanelOpenResult{}, err
	}
	if !render {
		if err := r.focusWorkspacePanel(panel); err != nil {
			return panelwindow.PanelOpenResult{}, err
		}
	}
	r.emitWorkspaceChanged(tab.ObjectRef.ClusterID)
	return panelwindow.PanelOpenResult{Panel: panel, Render: render}, nil
}

func (r *Registry) focusWorkspacePanel(panel panelwindow.WorkspacePanel) error {
	location := panel.Location
	eventName := panelwindow.WorkspaceFocusRequestedEventName
	var event any = panelwindow.WorkspaceFocusRequestedEvent{ClusterID: panel.Tab.ObjectRef.ClusterID, PanelID: panel.Tab.PanelID}
	if location.Kind == panelwindow.PanelLocationWindow {
		eventName = panelwindow.WindowFocusRequestedEventName
		event = panelwindow.WindowFocusRequestedEvent{PanelID: panel.Tab.PanelID}
	}
	if !r.emitWindowEvent(location.WindowName, eventName, event) || !r.focusWindow(location.WindowName) {
		return fmt.Errorf("panel location %q is not available", location.WindowName)
	}
	return nil
}

func (r *Registry) emitWorkspaceChanged(clusterID string) {
	names := append(r.lifecycle.Names(), r.panels.Names(clusterID)...)
	for _, windowName := range names {
		if r.windowHasCluster(windowName, clusterID) {
			r.emitWindowEvent(windowName, panelwindow.WorkspaceChangedEventName, panelwindow.WorkspaceChangedEvent{ClusterID: clusterID})
		}
	}
}

func (r *Registry) PublishDockedPanels(windowName string, groups []panelwindow.WorkspaceGroup) error {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if r.lifecycle == nil || !r.lifecycle.Contains(windowName) {
		return fmt.Errorf("app window %q is not live", windowName)
	}
	clusterIDs := r.backend.WindowClusterIDs(windowName)
	if err := panelwindow.ValidateWorkspaceGroups(windowName, panelwindow.PanelLocationDocked, groups); err != nil {
		return err
	}
	for _, group := range groups {
		if !slices.Contains(clusterIDs, group.ClusterID) {
			return fmt.Errorf("window %q does not display cluster %q", windowName, group.ClusterID)
		}
	}
	for _, group := range groups {
		if err := r.retainPanelWorkspace(group.ClusterID); err != nil {
			return err
		}
	}
	publishedGroups, err := r.excludeProvisionalDockTabs(windowName, groups)
	if err != nil {
		return err
	}
	if err := r.publishPanelGroups(windowName, panelwindow.PanelLocationDocked, publishedGroups); err != nil {
		return err
	}
	for _, clusterID := range clusterIDs {
		r.releaseUnusedPanelWorkspace(clusterID)
		r.emitWorkspaceChanged(clusterID)
	}
	return nil
}

type provisionalDockTab struct {
	tab      panelwindow.TabSnapshot
	position string
}

func (r *Registry) provisionalDockTabs(windowName string) map[string]provisionalDockTab {
	tabs := make(map[string]provisionalDockTab)
	r.addClusterTransferTabs(windowName, tabs)
	for _, name := range r.panels.Names("") {
		descriptor, err := r.panels.Descriptor(name)
		if err != nil || descriptor.State != PanelWindowStateDocking {
			continue
		}
		position, err := r.panels.DockTarget(name, descriptor.Snapshot.TransferID, windowName)
		if err != nil {
			continue
		}
		for _, tab := range descriptor.Snapshot.Tabs {
			tabs[tab.ObjectRef.ClusterID+"\x00"+tab.PanelID] = provisionalDockTab{tab, position}
		}
	}
	return tabs
}

// A provisional target can publish its mounted layout before its dock
// acknowledgement. Those tabs stay assigned to the native source until commit.
func (r *Registry) excludeProvisionalDockTabs(windowName string, groups []panelwindow.WorkspaceGroup) ([]panelwindow.WorkspaceGroup, error) {
	pending := r.provisionalDockTabs(windowName)
	result := make([]panelwindow.WorkspaceGroup, 0, len(groups))
	for _, group := range groups {
		kept, err := excludeProvisionalGroupTabs(group, pending)
		if err != nil {
			return nil, err
		}
		if len(kept.Tabs) == 0 {
			continue
		}
		if !slices.ContainsFunc(kept.Tabs, func(tab panelwindow.TabSnapshot) bool { return tab.PanelID == kept.ActivePanelID }) {
			kept.ActivePanelID = kept.Tabs[0].PanelID
		}
		result = append(result, kept)
	}
	return result, nil
}

func (r *Registry) retainPanelWorkspace(clusterID string) error {
	if r.backend == nil {
		return fmt.Errorf("cluster workspace lifecycle is not available")
	}
	return r.backend.RetainPanelCluster("panel-workspace:"+clusterID, clusterID)
}

func (r *Registry) releaseUnusedPanelWorkspace(clusterID string) {
	if r.backend == nil || len(r.workspace.Snapshot(clusterID).Panels) > 0 || len(r.panels.Names(clusterID)) > 0 {
		return
	}
	// Selection teardown is serialized by the workspace coordinator. This call
	// holds no directory or native-window index lock.
	if err := r.backend.ReleasePanelCluster("panel-workspace:" + clusterID); err != nil {
		r.reportPanelLifecycleError(err, "release shared panel workspace")
	}
}

func (r *Registry) releaseNativePanelReference(windowName string) error {
	if r.backend == nil {
		return nil
	}
	r.backend.ReleaseWorkspaceWindow(windowName)
	return r.backend.ReleasePanelCluster(windowName)
}

func (r *Registry) reportPanelLifecycleError(err error, action string) {
	if err != nil && r.application != nil && r.application.Logger != nil {
		r.application.Logger.Error(action, "error", err)
	}
}

func (r *Registry) addClusterTransferTabs(windowName string, tabs map[string]provisionalDockTab) {
	for _, transfer := range r.clusterTransfers {
		if !transfer.mounting || transfer.event.Request.TargetWindowName != windowName {
			continue
		}
		for _, group := range transfer.event.Snapshot.Groups {
			for _, tab := range group.Tabs {
				tabs[group.ClusterID+"\x00"+tab.PanelID] = provisionalDockTab{tab, group.GroupID}
			}
		}
	}
}

func excludeProvisionalGroupTabs(group panelwindow.WorkspaceGroup, pending map[string]provisionalDockTab) (panelwindow.WorkspaceGroup, error) {
	kept := group
	kept.Tabs = nil
	for _, tab := range group.Tabs {
		provisional, exists := pending[group.ClusterID+"\x00"+tab.PanelID]
		if !exists {
			kept.Tabs = append(kept.Tabs, tab)
			continue
		}
		if provisional.tab != tab || provisional.position != group.GroupID {
			return panelwindow.WorkspaceGroup{}, fmt.Errorf("provisional dock tab does not match the transfer")
		}
	}
	return kept, nil
}
