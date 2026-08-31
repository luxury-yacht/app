package snapshot

import (
	"sync/atomic"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// NamespaceWorkloadReadiness separates three states that used to collapse into one bool:
// startup has not settled, the startup deadline settled without complete data, and every
// workload source has produced an authoritative result.
type NamespaceWorkloadReadiness uint8

const (
	NamespaceWorkloadPending NamespaceWorkloadReadiness = iota
	NamespaceWorkloadDegraded
	NamespaceWorkloadReady
)

func (r NamespaceWorkloadReadiness) String() string {
	switch r {
	case NamespaceWorkloadDegraded:
		return "degraded"
	case NamespaceWorkloadReady:
		return "ready"
	default:
		return "pending"
	}
}

// NamespaceWorkloadTracker is the namespace domain's sync-readiness gate over the cut workload
// and pod ingest stores. Workload presence itself is read authoritatively from those stores on
// every build (NamespaceBuilder.namespacesWithWorkloads) — the same projected rows Browse
// reads — so there is no incremental presence map to drift. This gate reports (non-blocking)
// whether those stores have synced; until they have, a namespace's absence of workloads is
// reported as not-yet-known rather than as a definitive "no workloads", so the build never has
// to wait out the pod/workload initial LIST before the namespace list can paint. Its typed state
// also lets the cluster become operational after deadline settlement without claiming Ready.
type NamespaceWorkloadTracker struct {
	readinessFns []func() NamespaceWorkloadReadiness
	ready        atomic.Bool
}

// trackedWorkloadGVRs are the cut workload + pod kinds whose ingest-store sync the namespace
// domain waits on before treating a namespace's absence of workloads as authoritative.
var trackedWorkloadGVRs = []schema.GroupVersionResource{
	DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, PodGVR,
}

// trackerSyncSource is the ingest surface the cluster lifecycle gate waits on: whether the
// manager has an entry for a kind (Tracks), whether its liveness gate settled (HasSyncedFor),
// whether the store completed a real initial sync, and whether an explicit permission decision
// made the data unavailable. Deadline settlement is exposed as Degraded, never as Ready.
// *ingest.IngestManager satisfies it.
type trackerSyncSource interface {
	Tracks(gvr schema.GroupVersionResource) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
	RawHasSyncedFor(gvr schema.GroupVersionResource) bool
	PermissionSkippedFor(gvr schema.GroupVersionResource) bool
}

func newNamespaceWorkloadTracker() *NamespaceWorkloadTracker {
	return &NamespaceWorkloadTracker{}
}

// NewNamespaceWorkloadTracker wires the sync gate over the cut workload + pod ingest stores.
// It waits ONLY on kinds the manager actually has an entry for (Tracks): a kind with no entry
// reports RawHasSyncedFor=false forever (an unavailable client/scheme at registration), which
// would otherwise wedge the wait-for-all-synced gate and leave every namespace not-yet-known.
// ingestManager may be nil (a unit test), in which case the gate is immediately satisfied.
func NewNamespaceWorkloadTracker(ingestManager trackerSyncSource) *NamespaceWorkloadTracker {
	t := newNamespaceWorkloadTracker()
	if ingestManager == nil {
		t.ready.Store(true)
		return t
	}
	for _, gvr := range trackedWorkloadGVRs {
		if !ingestManager.Tracks(gvr) {
			continue
		}
		gvr := gvr
		t.readinessFns = append(t.readinessFns, func() NamespaceWorkloadReadiness {
			if ingestManager.RawHasSyncedFor(gvr) || ingestManager.PermissionSkippedFor(gvr) {
				return NamespaceWorkloadReady
			}
			if ingestManager.HasSyncedFor(gvr) {
				return NamespaceWorkloadDegraded
			}
			return NamespaceWorkloadPending
		})
	}
	return t
}

// Synced reports, WITHOUT blocking, whether every tracked ingest store completed its real
// initial sync or was explicitly permission-skipped. It remains the strict predicate used by
// governor Cold admission; namespace lifecycle builds use Readiness so they retain Degraded.
func (t *NamespaceWorkloadTracker) Synced() bool {
	return t.Readiness() == NamespaceWorkloadReady
}

// Readiness reports the aggregate startup state without blocking. Pending dominates degraded,
// and Ready latches because an informer that completed its initial sync remains authoritative
// through transient watch reconnects.
func (t *NamespaceWorkloadTracker) Readiness() NamespaceWorkloadReadiness {
	if t == nil {
		return NamespaceWorkloadPending
	}
	if t.ready.Load() {
		return NamespaceWorkloadReady
	}
	if len(t.readinessFns) == 0 {
		t.ready.Store(true)
		return NamespaceWorkloadReady
	}
	readiness := NamespaceWorkloadReady
	for _, sourceReadiness := range t.readinessFns {
		switch sourceReadiness() {
		case NamespaceWorkloadPending:
			return NamespaceWorkloadPending
		case NamespaceWorkloadDegraded:
			readiness = NamespaceWorkloadDegraded
		}
	}
	if readiness == NamespaceWorkloadReady {
		t.ready.Store(true)
	}
	return readiness
}
