package snapshot

import (
	"context"
	"sync/atomic"

	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
)

// NamespaceWorkloadTracker is the namespace domain's sync-readiness gate over the cut workload
// and pod ingest stores. Workload presence itself is read authoritatively from those stores on
// every build (NamespaceBuilder.namespacesWithWorkloads) — the same projected rows Browse
// reads — so there is no incremental presence map to drift. This gate only blocks the first
// read until the stores have synced; before then a namespace's absence of workloads is reported
// as not-yet-known rather than as a definitive "no workloads".
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

// WaitForSync blocks until every tracked ingest store has synced or ctx is cancelled, latching
// synced on success. It reports whether the stores are synced.
func (t *NamespaceWorkloadTracker) WaitForSync(ctx context.Context) bool {
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
	if cache.WaitForCacheSync(ctx.Done(), t.syncFns...) {
		t.synced.Store(true)
		return true
	}
	return false
}
