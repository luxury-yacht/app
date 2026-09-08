package panelwindow

import "fmt"

// WorkspaceReservation retains an admitted panel mutation while the registry
// releases its mutex to wait for backend selection bookkeeping.
type WorkspaceReservation struct {
	directory *WorkspaceDirectory
	clusterID string
	id        uint64
}

func (d *WorkspaceDirectory) ReserveCluster(clusterID string) *WorkspaceReservation {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.reservations == nil {
		d.reservations = make(map[uint64]string)
	}
	d.nextReservation++
	d.reservations[d.nextReservation] = clusterID
	return &WorkspaceReservation{directory: d, clusterID: clusterID, id: d.nextReservation}
}

func (r *WorkspaceReservation) Live() bool {
	r.directory.mu.Lock()
	defer r.directory.mu.Unlock()
	return r.directory.reservations[r.id] == r.clusterID
}

func (r *WorkspaceReservation) Release() {
	r.directory.mu.Lock()
	defer r.directory.mu.Unlock()
	delete(r.directory.reservations, r.id)
}

func (d *WorkspaceDirectory) HasClusterReference(clusterID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, reserved := range d.reservations {
		if reserved == clusterID {
			return true
		}
	}
	for key := range d.panels {
		if key.clusterID == clusterID {
			return true
		}
	}
	return false
}

// Backend removal may race with registry validation. Check admission again under
// the same mutex that commits placement, so removed work cannot recreate panels.
func (d *WorkspaceDirectory) validateReservationsLocked(reservations []*WorkspaceReservation) error {
	for _, reservation := range reservations {
		if reservation == nil || reservation.directory != d || d.reservations[reservation.id] != reservation.clusterID {
			return fmt.Errorf("panel workspace admission is no longer live")
		}
	}
	return nil
}
