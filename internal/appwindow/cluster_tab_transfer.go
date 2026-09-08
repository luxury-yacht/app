package appwindow

import (
	"errors"
	"fmt"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
	"slices"
	"time"
)

type clusterViewTransfer struct {
	event         panelwindow.ClusterTabTransferEvent
	mounting      bool
	timeout       *time.Timer
	createdTarget bool
}

func (r *Registry) RequestClusterTabTransfer(caller string, request panelwindow.ClusterTabTransferRequest) error {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if err := r.validateClusterTabRequest(caller, request); err != nil {
		return err
	}
	if r.clusterTransfers == nil {
		r.clusterTransfers = make(map[string]*clusterViewTransfer)
		r.usedClusterTransferIDs = make(map[string]struct{})
	}
	if _, used := r.usedClusterTransferIDs[request.TransferID]; used {
		return fmt.Errorf("cluster transfer ID was already used")
	}
	for _, pending := range r.clusterTransfers {
		previous := pending.event.Request
		if previous.ClusterID == request.ClusterID {
			return fmt.Errorf("cluster already has a pending view transfer")
		}
	}
	transfer := &clusterViewTransfer{event: panelwindow.ClusterTabTransferEvent{Request: request}}
	r.clusterTransfers[request.TransferID] = transfer
	r.usedClusterTransferIDs[request.TransferID] = struct{}{}
	if r.clusterTransferTimeout > 0 {
		transfer.timeout = time.AfterFunc(r.clusterTransferTimeout, func() { _ = r.FailClusterTabTransfer(request.SourceWindowName, request.TransferID) })
	}
	if !r.emitWindowEvent(request.SourceWindowName, panelwindow.ClusterTabTransferRequestedEventName, transfer.event) {
		r.removeClusterTransferLocked(request.TransferID)
		return fmt.Errorf("cluster transfer source is not available")
	}
	return nil
}

func (r *Registry) validateClusterTabRequest(caller string, request panelwindow.ClusterTabTransferRequest) error {
	if request.TransferID == "" || request.ClusterID == "" || request.TargetIndex < 0 || request.SourceWindowName == request.TargetWindowName {
		return fmt.Errorf("invalid cluster tab transfer")
	}
	if !r.lifecycle.Contains(request.SourceWindowName) || !r.windowHasCluster(request.SourceWindowName, request.ClusterID) {
		return fmt.Errorf("cluster transfer source is not live")
	}
	if request.TargetWindowName == "" {
		if caller != request.SourceWindowName {
			return fmt.Errorf("new app window transfer requires its source caller")
		}
	} else if !r.lifecycle.Contains(request.TargetWindowName) || (caller != request.TargetWindowName && caller != request.SourceWindowName) {
		return fmt.Errorf("cluster transfer target or caller is not live")
	}
	return nil
}

func (r *Registry) AcceptClusterTabTransfer(source, id string, snapshot panelwindow.ClusterViewSnapshot) error {
	var closeWindows []string
	r.clusterTransferMu.Lock()
	r.workspaceMu.Lock()
	defer r.finishClusterTransferMutation(&closeWindows, "")
	transfer := r.clusterTransfers[id]
	if transfer == nil || transfer.mounting || transfer.event.Request.SourceWindowName != source {
		return fmt.Errorf("cluster transfer source or state is stale")
	}
	request := transfer.event.Request
	if err := panelwindow.ValidateClusterViewSnapshot(request.ClusterID, source, snapshot); err != nil {
		return err
	}
	alreadyOpen, err := r.stageClusterTransferTargetUnlocked(transfer)
	if err != nil {
		return err
	}
	request = transfer.event.Request
	snapshot.Groups = slices.Clone(snapshot.Groups)
	for i := range snapshot.Groups {
		snapshot.Groups[i].Tabs = slices.Clone(snapshot.Groups[i].Tabs)
	}
	transfer.event = panelwindow.ClusterTabTransferEvent{Request: request, Snapshot: snapshot, TargetAlreadyOpen: alreadyOpen}
	transfer.mounting = true
	if !r.queueWorkspaceEvent(request.TargetWindowName, panelwindow.ClusterTabTransferInsertEventName, transfer.event) {
		return errors.Join(fmt.Errorf("cluster transfer target is unavailable"), r.cancelClusterTransferLocked(id, &closeWindows))
	}
	return nil
}

func (r *Registry) AcknowledgeClusterTabTransfer(target, id string) error {
	var closeWindows []string
	r.clusterTransferMu.Lock()
	r.workspaceMu.Lock()
	defer r.finishClusterTransferMutation(&closeWindows, "")
	transfer := r.clusterTransfers[id]
	if transfer == nil || !transfer.mounting || transfer.event.Request.TargetWindowName != target {
		return fmt.Errorf("cluster transfer acknowledgement is stale")
	}
	event := transfer.event
	request := event.Request
	r.workspaceMu.Unlock()
	err := r.backend.CommitClusterViewTransfer(request.SourceWindowName, target, request.ClusterID, event.Snapshot.Groups)
	r.workspaceMu.Lock()
	if err != nil {
		return err
	}
	r.removeClusterTransferLocked(id)
	r.emitClusterTransfer(event, panelwindow.ClusterTabTransferCommittedEventName)
	r.emitWorkspaceChanged(request.ClusterID)
	closeWindows = append(closeWindows, request.SourceWindowName)
	return nil
}

func (r *Registry) FailClusterTabTransfer(caller, id string) error {
	var closeWindows []string
	r.clusterTransferMu.Lock()
	r.workspaceMu.Lock()
	defer r.finishClusterTransferMutation(&closeWindows, "")
	transfer := r.clusterTransfers[id]
	if transfer == nil {
		return fmt.Errorf("cluster transfer is no longer pending")
	}
	request := transfer.event.Request
	if caller != request.SourceWindowName && caller != request.TargetWindowName {
		return fmt.Errorf("caller is not a cluster transfer participant")
	}
	return r.cancelClusterTransferLocked(id, &closeWindows)
}

func (r *Registry) cancelClusterTransferLocked(id string, closeWindows *[]string) error {
	transfer := r.clusterTransfers[id]
	if transfer == nil {
		return nil
	}
	event := transfer.event
	if transfer.mounting && !event.TargetAlreadyOpen {
		r.workspaceMu.Unlock()
		err := r.backend.CancelClusterViewTransfer(event.Request.TargetWindowName, event.Request.ClusterID)
		r.workspaceMu.Lock()
		if err != nil {
			return err
		}
	}
	r.discardQueuedClusterInsert(event.Request.TargetWindowName, id)
	r.removeClusterTransferLocked(id)
	r.emitClusterTransfer(event, panelwindow.ClusterTabTransferFailedEventName)
	if transfer.createdTarget {
		*closeWindows = append(*closeWindows, event.Request.TargetWindowName)
	}
	return nil
}

func (r *Registry) removeClusterTransferLocked(id string) {
	if transfer := r.clusterTransfers[id]; transfer != nil && transfer.timeout != nil {
		transfer.timeout.Stop()
	}
	delete(r.clusterTransfers, id)
}

func (r *Registry) emitClusterTransfer(event panelwindow.ClusterTabTransferEvent, name string) {
	r.emitWindowEvent(event.Request.SourceWindowName, name, event)
	if event.Request.TargetWindowName != "" {
		r.emitWindowEvent(event.Request.TargetWindowName, name, event)
	}
}

// clusterTransferMu keeps this transaction stable while workspaceMu is released.
// Publish the staged copy only after taking the directory lock again, since panel
// publications inspect the pending transfer under that lock.
func (r *Registry) stageClusterTransferTargetUnlocked(transfer *clusterViewTransfer) (bool, error) {
	staged := *transfer
	r.workspaceMu.Unlock()
	alreadyOpen, err := r.stageClusterTransferTarget(&staged)
	r.workspaceMu.Lock()
	*transfer = staged
	return alreadyOpen, err
}

// Reserve the destination's cluster view before creating its renderer. Initial
// hydration must never seed a transferred window from the whole process union.
func (r *Registry) stageClusterTransferTarget(transfer *clusterViewTransfer) (bool, error) {
	request := &transfer.event.Request
	if request.TargetWindowName != "" {
		return r.backend.StageClusterViewTransfer(request.SourceWindowName, request.TargetWindowName, request.ClusterID)
	}
	geometrySource := request.SourceWindowName
	if !r.lifecycle.Contains(geometrySource) {
		geometrySource = r.lifecycle.MostRecent()
	}
	target := r.lifecycle.Add()
	alreadyOpen, err := r.backend.StageClusterViewTransfer(request.SourceWindowName, target, request.ClusterID)
	if err != nil {
		r.lifecycle.BeginClose(target)
		return false, err
	}
	window := r.newWindow(r.clusterTransferWindowOptions(target, geometrySource, *request))
	if window == nil {
		cleanup := r.backend.CancelClusterViewTransfer(target, request.ClusterID)
		r.lifecycle.BeginClose(target)
		return false, errors.Join(fmt.Errorf("create cluster transfer destination"), cleanup)
	}
	request.TargetWindowName = target
	transfer.createdTarget = true
	r.registerLifecycleHooks(window, target, false)
	return alreadyOpen, nil
}

func (r *Registry) clusterTransferWindowOptions(windowName, geometrySource string, request panelwindow.ClusterTabTransferRequest) application.WebviewWindowOptions {
	options := r.optionsForPeer(windowName, geometrySource, false)
	if request.DropPosition == nil {
		return options
	}
	// Match panel tear-offs: keep the title bar near the pointer and restore a
	// movable window even when the source app window was maximised.
	options.StartState = application.WindowStateNormal
	r.positionWindowAtTransferredBounds(&options, panelwindow.WindowBounds{
		X: request.DropPosition.X - 120, Y: request.DropPosition.Y - 24,
		Width: options.Width, Height: options.Height,
	}, request.DropPosition)
	return options
}

func (r *Registry) discardQueuedClusterInsert(windowName, id string) {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if r.queuedWorkspaceEvents == nil {
		return
	}
	r.queuedWorkspaceEvents[windowName] = slices.DeleteFunc(r.queuedWorkspaceEvents[windowName], func(event workspaceWindowEvent) bool {
		transfer, ok := event.payload.(panelwindow.ClusterTabTransferEvent)
		return ok && transfer.Request.TransferID == id
	})
}

func (r *Registry) closeEmptyClusterTransferWindow(windowName string) {
	if len(r.backend.WindowClusterIDs(windowName)) > 0 {
		return
	}
	r.authorizeClose(windowName)
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
	}
}

func (r *Registry) failClusterTransfersForWindow(windowName string) error {
	var closeWindows []string
	r.clusterTransferMu.Lock()
	r.workspaceMu.Lock()
	defer r.finishClusterTransferMutation(&closeWindows, windowName)
	for id, transfer := range r.clusterTransfers {
		request := transfer.event.Request
		if request.SourceWindowName != windowName && request.TargetWindowName != windowName {
			continue
		}
		if err := r.cancelClusterTransferLocked(id, &closeWindows); err != nil {
			return err
		}
	}
	return nil
}

// A native app-window close may synchronously enter handleClosing. Release the
// transfer mutex before closing an empty source or a cancelled provisional target.
func (r *Registry) finishClusterTransferMutation(closeWindows *[]string, closingWindow string) {
	r.workspaceMu.Unlock()
	r.clusterTransferMu.Unlock()
	for _, windowName := range *closeWindows {
		if windowName != closingWindow {
			r.closeEmptyClusterTransferWindow(windowName)
		}
	}
}
