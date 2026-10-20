package snapshot

import (
	"fmt"
	"strings"
	"sync"
	"time"

	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/doorbell"
)

// namespaceNotifierDebounce coalesces event bursts (a rollout creating dozens of
// pods, a reflector relist) into one doorbell.
const namespaceNotifierDebounce = 500 * time.Millisecond

// namespaceNotifierNotReadySettleInterval caps presence-change broadcasts while
// the workload stores are still SETTLING: the presence signature changes on
// nearly every ingest batch during initial sync, and an unthrottled doorbell
// per debounce tick is a client refetch storm for the whole warm-up. Matches
// the legacy poll cadence, so incremental dimming resolves no slower than the
// polling it replaced. Namespace-object events and the ready flip bypass it.
const namespaceNotifierNotReadySettleInterval = 2 * time.Second

// NamespaceChangeNotifier turns the (rare) events that change the namespaces
// snapshot into a doorbell broadcast, replacing the frontend's 2s poll:
//
//   - a Namespace object add/update/delete broadcasts unconditionally (the rows
//     come solely from the namespace informer);
//   - workload/pod ingest events broadcast ONLY when the workload-presence or health-rollup
//     signature changes (the exact signature the snapshot stamps as its "workloads" source
//     clock), so steady pod churn stays silent;
//   - Events informer mutations broadcast ONLY when the per-namespace Warning
//     count or its availability state changes, so Normal-event churn stays silent;
//   - while the workload tracker is not ready, the notifier re-arms itself so
//     pending→degraded→ready edges broadcast even with no further ingest event.
//     Idle ticks inspect only readiness; they do not re-walk workload rows. It
//     also re-arms while an expected Events informer is warming, so an empty
//     synced cache becomes an authoritative zero. The re-arm stops once every
//     expected signal source is ready.
//
// Inputs may fire from informer/reflector goroutines. The flush is a generation
// callback of the cluster's doorbell, so stopping the generation cancels a
// pending flush and waits for a running one.
type NamespaceChangeNotifier struct {
	ingest  namespacePodIngestSource
	tracker *NamespaceWorkloadTracker

	eventLister    corelisters.EventLister
	eventsExpected bool
	eventsSynced   cache.InformerSynced

	bell doorbell.Bell
	// afterRing runs after each namespaces ring (the cluster-Ready self-build).
	afterRing func(version, reason string)

	mu                       sync.Mutex
	timer                    doorbell.Timer
	debounce                 time.Duration
	namespaceDirty           bool
	workloadDirty            bool
	eventDirty               bool
	quotaDirty               bool
	signatureKnown           bool
	lastSignature            string
	workloadReadinessKnown   bool
	lastWorkloadReadiness    NamespaceWorkloadReadiness
	workloadSignaturePending bool
	eventSignatureKnown      bool
	lastEventSignature       string
	lastEventReady           bool
	quotaSignatureKnown      bool
	lastQuotaSignature       string
	lastQuotaReady           bool
	// notReadyMinInterval floors presence-only broadcasts while settling; see
	// namespaceNotifierNotReadySettleInterval. Overridable in tests.
	notReadyMinInterval time.Duration
	lastPresenceAt      time.Time
	counter             uint64
}

// NewNamespaceChangeNotifier builds a notifier over the same ingest source and
// tracker the namespaces builder reads, so the presence signature can never
// drift from what Build serves. It rings bell, then calls afterRing (may be nil).
func NewNamespaceChangeNotifier(
	ingest namespacePodIngestSource,
	tracker *NamespaceWorkloadTracker,
	bell doorbell.Bell,
	afterRing func(version, reason string),
) *NamespaceChangeNotifier {
	return &NamespaceChangeNotifier{
		ingest:              ingest,
		tracker:             tracker,
		bell:                bell,
		afterRing:           afterRing,
		debounce:            namespaceNotifierDebounce,
		notReadyMinInterval: namespaceNotifierNotReadySettleInterval,
	}
}

// WorkloadsReady reports whether this notifier's workload tracker has real data or an explicit
// permission skip for every tracked source. Deadline degradation alone does not make it ready.
// The notifier and tracker belong to one refresh subsystem generation, so this
// is the generation-local readiness check used before that subsystem may cool.
func (n *NamespaceChangeNotifier) WorkloadsReady() bool {
	return n != nil && n.tracker != nil && n.tracker.Synced()
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

// EventChanged records an Events informer mutation that might change a
// namespace's warning-event count. The flush compares the aggregate signature,
// so Normal-event churn does not refetch the namespace list.
func (n *NamespaceChangeNotifier) EventChanged() {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.eventDirty = true
	n.mu.Unlock()
	n.arm()
}

// QuotaChanged records a ResourceQuota ingest mutation that may change one
// namespace's strongest pressure signal.
func (n *NamespaceChangeNotifier) QuotaChanged() {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.quotaDirty = true
	n.mu.Unlock()
	n.arm()
}

func (n *NamespaceChangeNotifier) arm() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.timer != nil {
		return
	}
	n.timer = n.bell.AfterFunc(n.debounce, n.flush)
}

func (n *NamespaceChangeNotifier) flush() {
	state := n.beginFlush()

	reasons := namespaceFlushReasons(state.namespaceDirty)
	workloadReasons, ready := n.workloadFlushReasons(state.workloadDirty, state.namespaceDirty)
	reasons = append(reasons, workloadReasons...)
	eventReasons, eventReady := n.eventFlushReasons(state.eventDirty)
	reasons = append(reasons, eventReasons...)
	quotaReasons, quotaReady := n.quotaFlushReasons(state.quotaDirty)
	reasons = append(reasons, quotaReasons...)
	n.ringFlushReasons(reasons)

	if !ready || (n.eventsExpected && !eventReady) || !quotaReady {
		n.arm()
	}
}

type namespaceFlushState struct {
	namespaceDirty bool
	workloadDirty  bool
	eventDirty     bool
	quotaDirty     bool
}

func (n *NamespaceChangeNotifier) beginFlush() namespaceFlushState {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.timer = nil
	state := namespaceFlushState{
		namespaceDirty: n.namespaceDirty,
		workloadDirty:  n.workloadDirty,
		eventDirty:     n.eventDirty,
		quotaDirty:     n.quotaDirty,
	}
	n.namespaceDirty = false
	n.workloadDirty = false
	n.eventDirty = false
	n.quotaDirty = false
	return state
}

func namespaceFlushReasons(namespaceDirty bool) []string {
	if namespaceDirty {
		return []string{"namespace object changed"}
	}
	return nil
}

func (n *NamespaceChangeNotifier) workloadFlushReasons(workloadDirty, namespaceDirty bool) ([]string, bool) {
	readiness := n.tracker.Readiness()
	ready := readiness == NamespaceWorkloadReady
	n.mu.Lock()
	readinessChanged := !n.workloadReadinessKnown || n.lastWorkloadReadiness != readiness
	needSignature := workloadDirty || !n.signatureKnown || readinessChanged || n.workloadSignaturePending
	n.mu.Unlock()
	if !needSignature {
		return nil, ready
	}
	signature := workloadRollupSignature(namespaceWorkloadRollupsFromIngest(n.ingest), readiness)
	n.mu.Lock()
	defer n.mu.Unlock()
	n.workloadReadinessKnown = true
	n.lastWorkloadReadiness = readiness
	if n.signatureKnown && signature == n.lastSignature {
		n.workloadSignaturePending = false
		return nil, ready
	}
	hadSignature := n.signatureKnown
	if n.workloadSignatureThrottled(hadSignature, readinessChanged, ready, namespaceDirty) {
		n.workloadSignaturePending = true
		return nil, ready
	}
	n.workloadSignaturePending = false
	n.signatureKnown = true
	n.lastSignature = signature
	n.lastPresenceAt = time.Now()
	return []string{workloadFlushReason(hadSignature, readiness)}, ready
}

func (n *NamespaceChangeNotifier) workloadSignatureThrottled(hadSignature, readinessChanged, ready, namespaceDirty bool) bool {
	return hadSignature && !readinessChanged && !ready && !namespaceDirty && time.Since(n.lastPresenceAt) < n.notReadyMinInterval
}

func workloadFlushReason(hadSignature bool, readiness NamespaceWorkloadReadiness) string {
	if !hadSignature {
		return "workload-presence baseline established"
	}
	if readiness == NamespaceWorkloadPending {
		return "workload rollup changed while stores are still settling"
	}
	if readiness == NamespaceWorkloadDegraded {
		return "workload sources settled with incomplete data"
	}
	return "workload rollup changed (presence, health, reservations, or store readiness changed)"
}

func (n *NamespaceChangeNotifier) eventFlushReasons(eventDirty bool) ([]string, bool) {
	eventReady := !n.eventsExpected || (n.eventsSynced != nil && n.eventsSynced())
	n.mu.Lock()
	needEventSignature := eventDirty || !n.eventSignatureKnown || (n.eventsExpected && !n.lastEventReady)
	n.mu.Unlock()
	if !needEventSignature {
		return nil, eventReady
	}
	counts, state := namespaceWarningEventRollups(n.eventLister, n.eventsExpected, n.eventsSynced)
	signature := warningEventRollupSignature(counts, state)
	n.mu.Lock()
	defer n.mu.Unlock()
	n.lastEventReady = eventReady
	if n.eventSignatureKnown && signature == n.lastEventSignature {
		return nil, eventReady
	}
	hadSignature := n.eventSignatureKnown
	n.eventSignatureKnown = true
	n.lastEventSignature = signature
	if !hadSignature {
		return []string{"warning-event baseline established"}, eventReady
	}
	return []string{"warning event count changed"}, eventReady
}

func (n *NamespaceChangeNotifier) quotaFlushReasons(quotaDirty bool) ([]string, bool) {
	n.mu.Lock()
	needQuotaSignature := quotaDirty || !n.quotaSignatureKnown || !n.lastQuotaReady
	quotaReady := n.lastQuotaReady
	n.mu.Unlock()
	if !needQuotaSignature {
		return nil, quotaReady
	}
	quotaRollups, quotaState := namespaceQuotaRollupsFromIngest(n.ingest)
	quotaReady = quotaState != NamespaceSignalLoading
	signature := namespaceQuotaRollupSignature(quotaRollups, quotaState)
	n.mu.Lock()
	defer n.mu.Unlock()
	n.lastQuotaReady = quotaReady
	if n.quotaSignatureKnown && signature == n.lastQuotaSignature {
		return nil, quotaReady
	}
	hadSignature := n.quotaSignatureKnown
	n.quotaSignatureKnown = true
	n.lastQuotaSignature = signature
	if !hadSignature {
		return []string{"quota-pressure baseline established"}, quotaReady
	}
	return []string{"quota pressure changed"}, quotaReady
}

func (n *NamespaceChangeNotifier) ringFlushReasons(reasons []string) {
	if len(reasons) == 0 {
		return
	}
	n.mu.Lock()
	n.counter++
	version := fmt.Sprintf("ns-%d", n.counter)
	n.mu.Unlock()
	reason := strings.Join(reasons, "; ")
	n.bell.Ring(doorbell.Change{
		Domain:  "namespaces",
		Source:  doorbell.SourceObject,
		Target:  doorbell.Subscribed(),
		Version: version,
		Reason:  reason,
	})
	// After the ring: a self-build triggered here always sees post-change data.
	if n.afterRing != nil {
		n.afterRing(version, reason)
	}
}
