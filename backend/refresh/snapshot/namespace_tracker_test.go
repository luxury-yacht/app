package snapshot

import (
	"testing"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// fakeSyncSource drives the tracker's per-GVR sync gate in tests: `tracked` is the set of GVRs
// the manager has an entry for, `synced` the set whose store has settled.
type fakeSyncSource struct {
	tracked map[schema.GroupVersionResource]bool
	synced  map[schema.GroupVersionResource]bool
}

func (f fakeSyncSource) Tracks(gvr schema.GroupVersionResource) bool       { return f.tracked[gvr] }
func (f fakeSyncSource) HasSyncedFor(gvr schema.GroupVersionResource) bool { return f.synced[gvr] }

func allTrackedSyncSource(synced bool) fakeSyncSource {
	tracked := make(map[schema.GroupVersionResource]bool, len(trackedWorkloadGVRs))
	syncedSet := make(map[schema.GroupVersionResource]bool, len(trackedWorkloadGVRs))
	for _, gvr := range trackedWorkloadGVRs {
		tracked[gvr] = true
		syncedSet[gvr] = synced
	}
	return fakeSyncSource{tracked: tracked, synced: syncedSet}
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

func TestNamespaceWorkloadTrackerWaitsOnlyOnTrackedKinds(t *testing.T) {
	// A kind the manager has NO entry for reports HasSyncedFor=false forever; it must NOT hold
	// the gate down — only kinds the manager actually tracks are considered. Here only Deployment
	// is tracked (and synced); the other workload/pod kinds are untracked, so Synced reports
	// synced because the one tracked kind has settled.
	src := fakeSyncSource{
		tracked: map[schema.GroupVersionResource]bool{DeploymentGVR: true},
		synced:  map[schema.GroupVersionResource]bool{DeploymentGVR: true},
	}
	tracker := NewNamespaceWorkloadTracker(src)
	if !tracker.Synced() {
		t.Fatalf("expected synced: an untracked, never-syncing kind must not hold the gate down")
	}
}
