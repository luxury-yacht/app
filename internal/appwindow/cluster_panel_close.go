package appwindow

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

type clusterPanelClose struct {
	id, caller, clusterID string
	windows               []string
	waiting               map[string]struct{}
	answer                chan bool
}

// CloseClusterView runs after the app renderer guards and flushes its
// docked panels. A duplicate app view retains the shared panel workspace.
func (r *Registry) CloseClusterView(ctx context.Context, caller, clusterID string) (bool, error) {
	pending, err := r.beginClusterPanelClose(caller, clusterID)
	if err != nil {
		return false, err
	}
	defer r.finishClusterPanelClose(pending)
	allowed, err := r.awaitClusterPanelClose(ctx, pending)
	if err != nil || !allowed {
		return false, err
	}
	return r.commitClusterPanelClose(pending)
}

func (r *Registry) hasOtherClusterAppView(caller, clusterID string) bool {
	for _, name := range r.lifecycle.Names() {
		if name != caller && r.windowHasCluster(name, clusterID) {
			return true
		}
	}
	return false
}

func (r *Registry) validateClusterPanelClose(caller, clusterID string) error {
	if !r.lifecycle.Contains(caller) || !r.windowHasCluster(caller, clusterID) {
		return fmt.Errorf("cluster close source is not live")
	}
	for _, transfer := range r.clusterTransfers {
		if transfer.event.Request.ClusterID == clusterID {
			return fmt.Errorf("cluster has a pending view transfer")
		}
	}
	for _, name := range r.panels.Names(clusterID) {
		if r.panels.State(name) != PanelWindowStateLive {
			return fmt.Errorf("cluster panel window is still transferring")
		}
	}
	return nil
}

func (r *Registry) beginClusterPanelClose(caller, clusterID string) (*clusterPanelClose, error) {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if err := r.validateClusterPanelClose(caller, clusterID); err != nil {
		return nil, err
	}
	r.clusterCloseMu.Lock()
	defer r.clusterCloseMu.Unlock()
	for _, pending := range r.clusterPanelCloses {
		if pending.clusterID == clusterID {
			return nil, fmt.Errorf("cluster close is already pending")
		}
	}
	r.nextClusterClose++
	pending := &clusterPanelClose{
		id: fmt.Sprintf("cluster-close-%d", r.nextClusterClose), caller: caller, clusterID: clusterID,
		waiting: make(map[string]struct{}), answer: make(chan bool, 1),
	}
	if !r.hasOtherClusterAppView(caller, clusterID) {
		pending.windows = r.panels.Names(clusterID)
	}
	for _, name := range pending.windows {
		pending.waiting[name] = struct{}{}
	}
	if r.clusterPanelCloses == nil {
		r.clusterPanelCloses = make(map[string]*clusterPanelClose)
	}
	r.clusterPanelCloses[pending.id] = pending
	return pending, nil
}

func (r *Registry) awaitClusterPanelClose(ctx context.Context, pending *clusterPanelClose) (bool, error) {
	for _, name := range pending.windows {
		event := panelwindow.ClusterPanelCloseEvent{TransactionID: pending.id, WindowName: name, ClusterID: pending.clusterID}
		if !r.emitWindowEvent(name, panelwindow.ClusterPanelCloseRequestedEventName, event) {
			return false, fmt.Errorf("cluster panel window %q is unavailable", name)
		}
	}
	if len(pending.windows) == 0 {
		return true, ctx.Err()
	}
	var timeout <-chan time.Time
	if r.clusterCloseTimeout > 0 {
		timer := time.NewTimer(r.clusterCloseTimeout)
		defer timer.Stop()
		timeout = timer.C
	}
	select {
	case allowed := <-pending.answer:
		return allowed, ctx.Err()
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timeout:
		return false, fmt.Errorf("cluster panel close timed out")
	}
}

func (r *Registry) AcknowledgeClusterPanelClose(windowName, transactionID string, allowed bool) error {
	r.clusterCloseMu.Lock()
	defer r.clusterCloseMu.Unlock()
	pending := r.clusterPanelCloses[transactionID]
	if pending == nil {
		return fmt.Errorf("cluster close acknowledgement is stale")
	}
	if _, waiting := pending.waiting[windowName]; !waiting {
		return fmt.Errorf("window is not awaiting cluster close")
	}
	delete(pending.waiting, windowName)
	if !allowed || len(pending.waiting) == 0 {
		select {
		case pending.answer <- allowed:
		default:
		}
	}
	return nil
}

func (r *Registry) commitClusterPanelClose(pending *clusterPanelClose) (bool, error) {
	r.workspaceMu.Lock()
	err := r.validateClusterPanelClose(pending.caller, pending.clusterID)
	shared := r.hasOtherClusterAppView(pending.caller, pending.clusterID)
	current := r.panels.Names(pending.clusterID)
	r.workspaceMu.Unlock()
	if err != nil {
		return false, err
	}
	if shared {
		return true, r.backend.CloseClusterView(pending.caller, pending.clusterID)
	}
	if !slices.Equal(current, pending.windows) {
		return false, fmt.Errorf("cluster panel windows changed during close")
	}
	// Native destruction can synchronously enter lifecycle hooks. Hold neither
	// the workspace mutex nor the acknowledgement mutex while closing windows.
	for _, name := range pending.windows {
		if err := r.AcknowledgePanelWindowClose(name); err != nil {
			return false, err
		}
	}
	r.workspaceMu.Lock()
	r.workspace.RemoveCluster(pending.clusterID)
	r.workspaceMu.Unlock()
	r.releaseUnusedPanelWorkspace(pending.clusterID)
	r.emitWorkspaceChanged(pending.clusterID)
	return true, r.backend.CloseClusterView(pending.caller, pending.clusterID)
}

func (r *Registry) finishClusterPanelClose(pending *clusterPanelClose) {
	r.clusterCloseMu.Lock()
	delete(r.clusterPanelCloses, pending.id)
	r.clusterCloseMu.Unlock()
	for _, name := range pending.windows {
		r.emitWindowEvent(name, panelwindow.ClusterPanelCloseSettledEventName, panelwindow.ClusterPanelCloseEvent{
			TransactionID: pending.id, WindowName: name, ClusterID: pending.clusterID,
		})
	}
}
