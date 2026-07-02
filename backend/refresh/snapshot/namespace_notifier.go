package snapshot

import (
	"fmt"
	"sync"
	"time"
)

// namespaceNotifierDebounce coalesces event bursts (a rollout creating dozens of
// pods, a reflector relist) into one doorbell.
const namespaceNotifierDebounce = 500 * time.Millisecond

// NamespaceChangeNotifier turns the (rare) events that change the namespaces
// snapshot into a doorbell broadcast, replacing the frontend's 2s poll:
//
//   - a Namespace object add/update/delete broadcasts unconditionally (the rows
//     come solely from the namespace informer);
//   - workload/pod ingest events broadcast ONLY when the workload-presence
//     signature changes (the exact signature the snapshot stamps as its
//     "workloads" source clock), so steady pod churn stays silent;
//   - while the workload tracker has not settled, the notifier re-arms itself so
//     the readiness flip broadcasts even with no further ingest event — the
//     cluster-Ready lifecycle gate needs a namespaces build AFTER settling. The
//     re-arm stops permanently once ready.
//
// Inputs may fire from informer/reflector goroutines; the broadcast sink is
// wired later (the resource-stream manager is built after domain registration),
// so pending events are retained until SetBroadcast arrives.
type NamespaceChangeNotifier struct {
	ingest  namespacePodIngestSource
	tracker *NamespaceWorkloadTracker

	mu             sync.Mutex
	broadcast      func(version string)
	timer          *time.Timer
	debounce       time.Duration
	namespaceDirty bool
	workloadDirty  bool
	signatureKnown bool
	lastSignature  string
	// lastSignatureReady records whether lastSignature was computed AFTER the
	// tracker settled; a not-ready signature must be recomputed on the rearm
	// tick even with no new events, so the readiness flip itself broadcasts.
	lastSignatureReady bool
	counter            uint64
	stopped            bool
}

// NewNamespaceChangeNotifier builds a notifier over the same ingest source and
// tracker the namespaces builder reads, so the presence signature can never
// drift from what Build serves.
func NewNamespaceChangeNotifier(ingest namespacePodIngestSource, tracker *NamespaceWorkloadTracker) *NamespaceChangeNotifier {
	return &NamespaceChangeNotifier{
		ingest:   ingest,
		tracker:  tracker,
		debounce: namespaceNotifierDebounce,
	}
}

// SetBroadcast wires the doorbell sink. Events recorded before wiring are
// flushed on the next debounce tick.
func (n *NamespaceChangeNotifier) SetBroadcast(broadcast func(version string)) {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.broadcast = broadcast
	pending := n.namespaceDirty || n.workloadDirty
	n.mu.Unlock()
	if pending {
		n.arm()
	}
}

// NamespaceChanged records a Namespace object add/update/delete.
func (n *NamespaceChangeNotifier) NamespaceChanged() {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.namespaceDirty = true
	n.mu.Unlock()
	n.arm()
}

// WorkloadChanged records a workload/pod ingest event that MIGHT flip a
// namespace's workload presence; the flush decides via the signature.
func (n *NamespaceChangeNotifier) WorkloadChanged() {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.workloadDirty = true
	n.mu.Unlock()
	n.arm()
}

// Stop cancels any pending flush; the notifier is discarded with its subsystem.
func (n *NamespaceChangeNotifier) Stop() {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.stopped = true
	timer := n.timer
	n.timer = nil
	n.mu.Unlock()
	if timer != nil {
		timer.Stop()
	}
}

func (n *NamespaceChangeNotifier) arm() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.stopped || n.timer != nil {
		return
	}
	n.timer = time.AfterFunc(n.debounce, n.flush)
}

func (n *NamespaceChangeNotifier) flush() {
	n.mu.Lock()
	n.timer = nil
	if n.stopped {
		n.mu.Unlock()
		return
	}
	broadcast := n.broadcast
	if broadcast == nil {
		// Not wired yet: keep the dirty flags; SetBroadcast re-arms.
		n.mu.Unlock()
		return
	}
	namespaceDirty := n.namespaceDirty
	workloadDirty := n.workloadDirty
	n.namespaceDirty = false
	n.workloadDirty = false
	n.mu.Unlock()

	// Compute outside the lock: the signature reads the ingest stores.
	ready := n.tracker.Synced()
	n.mu.Lock()
	// Recompute on workload events, and on the rearm tick whenever the last
	// signature predates readiness — the ready flip alone changes the
	// signature's ready bit and must broadcast.
	needSignature := workloadDirty || !n.signatureKnown || !n.lastSignatureReady
	n.mu.Unlock()
	fire := namespaceDirty
	if needSignature {
		signature := workloadPresenceSignature(namespacesWithWorkloadsFromIngest(n.ingest), ready)
		n.mu.Lock()
		if !n.signatureKnown || signature != n.lastSignature {
			n.signatureKnown = true
			n.lastSignature = signature
			fire = true
		}
		n.lastSignatureReady = ready
		n.mu.Unlock()
	}

	if fire {
		n.mu.Lock()
		n.counter++
		version := fmt.Sprintf("ns-%d", n.counter)
		n.mu.Unlock()
		broadcast(version)
	}

	// The cluster-Ready gate needs a build after the tracker settles; keep a
	// bounded self-rearm alive until then (it stops for good once ready).
	if !ready {
		n.arm()
	}
}
