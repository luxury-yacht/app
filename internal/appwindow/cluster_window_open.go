package appwindow

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/internal/panelwindow"
)

// OpenClusterWindow adds an app view without transferring the source's panels
// or removing its tab. Reserve admission while the seeded renderer is created
// so a concurrent final-tab close cannot dispose the shared workspace.
func (r *Registry) OpenClusterWindow(source, clusterID string) error {
	r.clusterTransferMu.Lock()
	defer r.clusterTransferMu.Unlock()
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	request := panelwindow.ClusterTabTransferRequest{
		TransferID: uuid.NewString(), SourceWindowName: source, ClusterID: clusterID,
	}
	if err := r.validateClusterTabRequest(source, request); err != nil {
		return err
	}
	if err := r.validateClusterWindowOpen(clusterID); err != nil {
		return err
	}
	transfer, err := r.reserveClusterTransferLocked(request)
	if err != nil {
		return err
	}
	defer r.removeClusterTransferLocked(request.TransferID)
	_, err = r.stageClusterTransferTargetUnlocked(transfer)
	return err
}

func (r *Registry) validateClusterWindowOpen(clusterID string) error {
	r.clusterCloseMu.Lock()
	defer r.clusterCloseMu.Unlock()
	for _, pending := range r.clusterPanelCloses {
		if pending.clusterID == clusterID {
			return fmt.Errorf("cluster close is already pending")
		}
	}
	return nil
}
