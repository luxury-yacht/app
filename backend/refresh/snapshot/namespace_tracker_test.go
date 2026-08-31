package snapshot

import (
	"testing"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// fakeSyncSource drives the tracker's per-GVR sync gate in tests: `tracked` is the set of GVRs
// the manager has an entry for, `settled` the set released by the startup liveness deadline,
// and `rawSynced` the set whose stores actually completed their initial sync.
type fakeSyncSource struct {
	tracked           map[schema.GroupVersionResource]bool
	settled           map[schema.GroupVersionResource]bool
	rawSynced         map[schema.GroupVersionResource]bool
	permissionSkipped map[schema.GroupVersionResource]bool
}

func (f fakeSyncSource) Tracks(gvr schema.GroupVersionResource) bool       { return f.tracked[gvr] }
func (f fakeSyncSource) HasSyncedFor(gvr schema.GroupVersionResource) bool { return f.settled[gvr] }
func (f fakeSyncSource) RawHasSyncedFor(gvr schema.GroupVersionResource) bool {
	return f.rawSynced[gvr]
}
func (f fakeSyncSource) PermissionSkippedFor(gvr schema.GroupVersionResource) bool {
	return f.permissionSkipped[gvr]
}

func allTrackedSyncSource(synced bool) fakeSyncSource {
	tracked := make(map[schema.GroupVersionResource]bool, len(trackedWorkloadGVRs))
	settled := make(map[schema.GroupVersionResource]bool, len(trackedWorkloadGVRs))
	rawSynced := make(map[schema.GroupVersionResource]bool, len(trackedWorkloadGVRs))
	for _, gvr := range trackedWorkloadGVRs {
		tracked[gvr] = true
		settled[gvr] = synced
		rawSynced[gvr] = synced
	}
	return fakeSyncSource{
		tracked:           tracked,
		settled:           settled,
		rawSynced:         rawSynced,
		permissionSkipped: make(map[schema.GroupVersionResource]bool, len(trackedWorkloadGVRs)),
	}
}

func TestNamespaceWorkloadTrackerNilSourceIsImmediatelySynced(t *testing.T) {
	tracker := NewNamespaceWorkloadTracker(nil)
	if !tracker.Synced() {
		t.Fatalf("expected a nil-source tracker to report synced")
	}
}

func TestNamespaceWorkloadTrackerSyncedOnceEveryTrackedStoreSyncs(t *testing.T) {
	tracker := NewNamespaceWorkloadTracker(allTrackedSyncSource(true))
	if !tracker.Synced() {
		t.Fatalf("expected tracker to report synced once every tracked store has synced")
	}
}

func TestNamespaceWorkloadTrackerNotSyncedWhenATrackedStoreNeverSyncs(t *testing.T) {
	// Every kind is tracked but none has synced; Synced reports not-synced (non-blocking) so the
	// build reports workload absence as not-yet-known rather than waiting for the stores.
	tracker := NewNamespaceWorkloadTracker(allTrackedSyncSource(false))
	if tracker.Synced() {
		t.Fatalf("expected Synced to report not-synced when a tracked store never syncs")
	}
}

func TestNamespaceWorkloadTrackerDeadlineDegradationDoesNotReportDataReady(t *testing.T) {
	source := allTrackedSyncSource(false)
	for _, gvr := range trackedWorkloadGVRs {
		source.settled[gvr] = true
	}

	tracker := NewNamespaceWorkloadTracker(source)
	if tracker.Synced() {
		t.Fatal("deadline-degraded stores must not make the cluster Ready before data loads")
	}

	for _, gvr := range trackedWorkloadGVRs {
		source.rawSynced[gvr] = true
	}
	if !tracker.Synced() {
		t.Fatal("a later real sync must still allow the cluster to become Ready")
	}
}

func TestNamespaceWorkloadTrackerPermissionSkippedKindIsSettled(t *testing.T) {
	source := allTrackedSyncSource(true)
	source.rawSynced[PodGVR] = false
	source.permissionSkipped[PodGVR] = true

	tracker := NewNamespaceWorkloadTracker(source)
	if !tracker.Synced() {
		t.Fatal("an explicit permission skip must not leave the cluster loading forever")
	}
}

func TestNamespaceWorkloadTrackerWaitsOnlyOnTrackedKinds(t *testing.T) {
	// A kind the manager has NO entry for reports RawHasSyncedFor=false forever; it must NOT hold
	// the gate down — only kinds the manager actually tracks are considered. Here only Deployment
	// is tracked (and synced); the other workload/pod kinds are untracked, so Synced reports
	// synced because the one tracked kind has settled.
	src := fakeSyncSource{
		tracked:   map[schema.GroupVersionResource]bool{DeploymentGVR: true},
		settled:   map[schema.GroupVersionResource]bool{DeploymentGVR: true},
		rawSynced: map[schema.GroupVersionResource]bool{DeploymentGVR: true},
	}
	tracker := NewNamespaceWorkloadTracker(src)
	if !tracker.Synced() {
		t.Fatalf("expected synced: an untracked, never-syncing kind must not hold the gate down")
	}
}
