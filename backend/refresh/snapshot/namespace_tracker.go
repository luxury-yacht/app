package snapshot

import (
	"sync/atomic"

	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
)

// NamespaceWorkloadTracker is the namespace domain's sync-readiness gate over the cut workload
// and pod ingest stores. Workload presence itself is read authoritatively from those stores on
// every build (NamespaceBuilder.namespacesWithWorkloads) — the same projected rows Browse
// reads — so there is no incremental presence map to drift. This gate reports (non-blocking)
// whether those stores have synced; until they have, a namespace's absence of workloads is
// reported as not-yet-known rather than as a definitive "no workloads", so the build never has
// to wait out the pod/workload initial LIST before the namespace list can paint.
type NamespaceWorkloadTracker struct {
	syncFns []cache.InformerSynced
	synced  atomic.Bool
}

// trackedWorkloadGVRs are the cut workload + pod kinds whose ingest-store sync the namespace
// domain waits on before treating a namespace's absence of workloads as authoritative.
var trackedWorkloadGVRs = []schema.GroupVersionResource{
	DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, PodGVR,
}

// trackerSyncSource is the ingest surface the gate waits on: whether the manager has an entry
// for a kind (Tracks) and whether that kind's store has settled (HasSyncedFor).
// *ingest.IngestManager satisfies it.
type trackerSyncSource interface {
	Tracks(gvr schema.GroupVersionResource) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
}

func newNamespaceWorkloadTracker() *NamespaceWorkloadTracker {
	return &NamespaceWorkloadTracker{}
}

// NewNamespaceWorkloadTracker wires the sync gate over the cut workload + pod ingest stores.
// It waits ONLY on kinds the manager actually has an entry for (Tracks): a kind with no entry
// reports HasSyncedFor=false forever (an unavailable client/scheme at registration), which would
// otherwise wedge the wait-for-all-synced gate and leave every namespace reported not-yet-known.
// ingestManager may be nil (a unit test), in which case the gate is immediately satisfied.
func NewNamespaceWorkloadTracker(ingestManager trackerSyncSource) *NamespaceWorkloadTracker {
	t := newNamespaceWorkloadTracker()
	if ingestManager == nil {
		t.synced.Store(true)
		return t
	}
	for _, gvr := range trackedWorkloadGVRs {
		if !ingestManager.Tracks(gvr) {
			continue
		}
		gvr := gvr
		t.syncFns = append(t.syncFns, func() bool { return ingestManager.HasSyncedFor(gvr) })
	}
	return t
}

// Synced reports, WITHOUT blocking, whether every tracked ingest store has synced, latching
// synced once true so later builds skip the per-store check. The namespace build calls this
// rather than waiting on the stores: a false result makes a namespace's absence of workloads
// report as not-yet-known, and the build's workload-presence source clock re-delivers the
// authoritative snapshot once the stores settle (see NamespaceBuilder.Build).
func (t *NamespaceWorkloadTracker) Synced() bool {
	if t == nil {
		return false
	}
	if t.synced.Load() {
		return true
	}
	if len(t.syncFns) == 0 {
		t.synced.Store(true)
		return true
	}
	for _, synced := range t.syncFns {
		if !synced() {
			return false
		}
	}
	t.synced.Store(true)
	return true
}
