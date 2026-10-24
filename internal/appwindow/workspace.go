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

// beginGroupPlacement asks the directory to move a native group transfer's
// panels. The directory validates them against its own placement; the native
// transfer's terminal releases the move unless it was committed first.
func (r *Registry) beginGroupPlacement(windowName string, snapshot panelwindow.GroupSnapshot, target panelwindow.PanelLocation, reservations ...*panelwindow.WorkspaceReservation) error {
	if err := r.workspace.BeginGroupTransfer(panelwindow.GroupTransfer{
		TransferID:   snapshot.TransferID,
		SourceWindow: snapshot.SourceWindowName,
		Target:       target,
		Group:        panelwindow.WorkspaceGroup{ClusterID: snapshot.ClusterID, Tabs: snapshot.Tabs, ActivePanelID: snapshot.ActivePanelID},
	}, reservations...); err != nil {
		return err
	}
	directory := r.workspace
	r.panels.attachRelease(windowName, snapshot.TransferID, func() { directory.CancelGroupTransfer(snapshot.TransferID) })
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
	r.closeAuthorizedWindow(descriptor.WindowName)
	r.panels.Remove(descriptor.WindowName)
	r.failPanelTabTransfer(descriptor.TransferID, "new panel target failed before readiness")
	cleanup := r.releaseNativePanelReference(descriptor.WindowName)
	r.emitPanelClosed(descriptor)
	return cleanup
}

func (r *Registry) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	if !r.windowHasCluster(windowName, clusterID) {
		return panelwindow.WorkspaceSnapshot{}, fmt.Errorf("window %q does not display cluster %q", windowName, clusterID)
	}
	return r.workspace.Snapshot(clusterID), nil
}

func (r *Registry) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	if !r.windowHasCluster(windowName, tab.ClusterID()) {
		return panelwindow.PanelOpenResult{}, fmt.Errorf("window %q does not display cluster %q", windowName, tab.ClusterID())
	}
	reservation := r.workspace.ReserveCluster(tab.ClusterID())
	defer r.releasePanelReservation(reservation, tab.ClusterID())
	if err := r.retainPanelWorkspace(tab.ClusterID()); err != nil {
		return panelwindow.PanelOpenResult{}, err
	}
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if !reservation.Live() || !r.windowHasCluster(windowName, tab.ClusterID()) {
		return panelwindow.PanelOpenResult{}, fmt.Errorf("panel source no longer displays the cluster")
	}
	location := panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: windowName, GroupID: "right", Active: true}
	if descriptor, err := r.panels.Descriptor(windowName); err == nil {
		location.Kind = panelwindow.PanelLocationWindow
		location.GroupID = descriptor.GroupID
	}
	panel, render, err := r.workspace.Open(tab, location, reservation)
	if err != nil {
		return panelwindow.PanelOpenResult{}, err
	}
	if !render {
		if err := r.focusWorkspacePanel(panel); err != nil {
			return panelwindow.PanelOpenResult{}, err
		}
	}
	r.emitWorkspaceChanged(tab.ClusterID())
	return panelwindow.PanelOpenResult{Panel: panel, Render: render}, nil
}

// ClosePanelWorkspaceObject removes a panel its renderer closed. The directory
// ignores a panel it has since placed elsewhere or is moving.
func (r *Registry) ClosePanelWorkspaceObject(windowName, clusterID, panelID string) error {
	if windowName == "" || clusterID == "" || panelID == "" {
		return fmt.Errorf("panel close requires window, cluster, and panel identity")
	}
	r.workspaceMu.Lock()
	closed := r.workspace.ClosePanel(windowName, clusterID, panelID)
	r.workspaceMu.Unlock()
	if !closed {
		return nil
	}
	r.releaseUnusedPanelWorkspace(clusterID)
	r.emitWorkspaceChanged(clusterID)
	return nil
}

func (r *Registry) releasePanelReservation(reservation *panelwindow.WorkspaceReservation, clusterID string) {
	reservation.Release()
	r.releaseUnusedPanelWorkspace(clusterID)
}

func (r *Registry) focusWorkspacePanel(panel panelwindow.WorkspacePanel) error {
	location := panel.Location
	eventName := panelwindow.WorkspaceFocusRequestedEventName
	var event any = panelwindow.WorkspaceFocusRequestedEvent{ClusterID: panel.Tab.ClusterID(), PanelID: panel.Tab.PanelID}
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
	clusterIDs, err := r.validateDockedPublication(windowName, groups)
	if err != nil {
		return err
	}
	reservations := make([]*panelwindow.WorkspaceReservation, 0, len(groups))
	defer func() {
		for _, reservation := range reservations {
			reservation.Release()
		}
		for _, clusterID := range clusterIDs {
			r.releaseUnusedPanelWorkspace(clusterID)
		}
	}()
	for _, group := range groups {
		reservations = append(reservations, r.workspace.ReserveCluster(group.ClusterID))
		if err := r.retainPanelWorkspace(group.ClusterID); err != nil {
			return err
		}
	}
	return r.commitDockedPublication(windowName, groups, clusterIDs, reservations)
}

func (r *Registry) commitDockedPublication(windowName string, groups []panelwindow.WorkspaceGroup, clusterIDs []string, reservations []*panelwindow.WorkspaceReservation) error {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if _, err := r.validateDockedPublication(windowName, groups); err != nil {
		return err
	}
	for _, reservation := range reservations {
		if !reservation.Live() {
			return fmt.Errorf("panel publication cluster was removed")
		}
	}
	if err := r.workspace.PublishWindow(windowName, panelwindow.PanelLocationDocked, groups, reservations...); err != nil {
		return err
	}
	for _, clusterID := range clusterIDs {
		r.emitWorkspaceChanged(clusterID)
	}
	return nil
}

func (r *Registry) validateDockedPublication(windowName string, groups []panelwindow.WorkspaceGroup) ([]string, error) {
	if r.lifecycle == nil || !r.lifecycle.Contains(windowName) {
		return nil, fmt.Errorf("app window %q is not live", windowName)
	}
	if err := panelwindow.ValidateWorkspaceGroups(windowName, panelwindow.PanelLocationDocked, groups); err != nil {
		return nil, err
	}
	clusterIDs := r.backend.WindowClusterIDs(windowName)
	for _, group := range groups {
		if !slices.Contains(clusterIDs, group.ClusterID) {
			return nil, fmt.Errorf("window %q does not display cluster %q", windowName, group.ClusterID)
		}
	}
	return clusterIDs, nil
}

func (r *Registry) retainPanelWorkspace(clusterID string) error {
	if r.backend == nil {
		return fmt.Errorf("cluster workspace lifecycle is not available")
	}
	return r.backend.RetainPanelCluster("panel-workspace:"+clusterID, clusterID)
}

func (r *Registry) releaseUnusedPanelWorkspace(clusterID string) {
	if r.backend == nil || r.workspace.HasClusterReference(clusterID) || len(r.panels.Names(clusterID)) > 0 {
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
