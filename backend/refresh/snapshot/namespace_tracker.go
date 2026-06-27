package snapshot

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

type workloadResource string

const (
	resourceDeployment workloadResource = "deployment"
	resourceStateful   workloadResource = "statefulset"
	resourceDaemon     workloadResource = "daemonset"
	resourceJob        workloadResource = "job"
	resourceCronJob    workloadResource = "cronjob"
	resourcePod        workloadResource = "pod"
)

// NamespaceWorkloadTracker maintains per-namespace workload presence using informer events.
type NamespaceWorkloadTracker struct {
	mu         sync.RWMutex
	namespaces map[string]*namespaceState
	syncFns    []cache.InformerSynced
	synced     atomic.Bool
	// source and tracked let WaitForSync seed the per-namespace baseline from each tracked
	// kind's current ingest rows once the stores report synced. The incremental sinks carry
	// live deltas, but a store restored from a cooled-cluster spill is marked synced WITHOUT
	// replaying its rows to those sinks (RestoreBundles), so without this seed the tracker
	// would miss every restored workload and wrongly report its namespaces inactive.
	source   trackerPodIngestSource
	tracked  []trackedWorkloadKind
	seedOnce sync.Once
}

// trackedWorkloadKind pairs a cut workload kind's GVR with the tracker's resource bucket,
// so the sync-time baseline seed reads each kind's ingest rows under the right bucket.
type trackedWorkloadKind struct {
	gvr      schema.GroupVersionResource
	resource workloadResource
}

type namespaceState struct {
	objects map[workloadResource]map[string]struct{}
	total   int
	unknown bool
}

func (s *namespaceState) add(resource workloadResource, key string) bool {
	if s.objects == nil {
		s.objects = make(map[workloadResource]map[string]struct{})
	}
	if _, ok := s.objects[resource]; !ok {
		s.objects[resource] = make(map[string]struct{})
	}
	if _, exists := s.objects[resource][key]; exists {
		return false
	}
	s.objects[resource][key] = struct{}{}
	s.total++
	return true
}

func (s *namespaceState) remove(resource workloadResource, key string) bool {
	if s.objects == nil {
		return false
	}
	items, ok := s.objects[resource]
	if !ok {
		return false
	}
	if _, exists := items[key]; !exists {
		return false
	}
	delete(items, key)
	if len(items) == 0 {
		delete(s.objects, resource)
	}
	if s.total > 0 {
		s.total--
	}
	return true
}

func (s *namespaceState) hasWorkloads() bool {
	return s.total > 0
}

func (s *namespaceState) shouldRetain() bool {
	return s.unknown || s.total > 0
}

func newNamespaceWorkloadTracker() *NamespaceWorkloadTracker {
	return &NamespaceWorkloadTracker{
		namespaces: make(map[string]*namespaceState),
	}
}

// trackerPodIngestSource supplies the cut pod and workload kinds' presence to the workload
// tracker: pods feed an incremental Table-half Sink (the pod store retains its Table half),
// while workload kinds feed a whole-bundle Sink because their stores DROP the Table half —
// the tracker reads namespace/name from the bundle's Catalog half on delete instead. Plus
// each kind's store HasSynced gate. The shared informer no longer caches these kinds, so the
// tracker reads their presence here. *ingest.IngestManager satisfies it.
type trackerPodIngestSource interface {
	AddSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool
	AddBundleSink(gvr schema.GroupVersionResource, sink ingest.BundleSink) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
	// CatalogRows returns each stored object's Catalog half (an objectcatalog.Summary,
	// carrying namespace/name) for gvr. WaitForSync reads it to seed the workload-presence
	// baseline a restored (no-fan) store never delivered through the sinks.
	CatalogRows(gvr schema.GroupVersionResource) []interface{}
}

// NewNamespaceWorkloadTracker wires the namespace workload-presence counts. Pods AND the
// five workload kinds are cut to the ingest path, so their presence comes from each kind's
// reflector Table-half Sink (and its HasSynced gate) rather than a shared informer.
// ingestManager may be nil (a unit test), in which case the cut kinds contribute no presence.
// factory is retained for signature compatibility with callers that still pass it; with all
// tracked kinds cut, no shared informer handler is registered here.
func NewNamespaceWorkloadTracker(factory informers.SharedInformerFactory, ingestManager trackerPodIngestSource) *NamespaceWorkloadTracker {
	tracker := newNamespaceWorkloadTracker()
	if ingestManager == nil {
		// No ingest source: nothing feeds the tracker, so it is immediately "synced" with
		// empty state (the namespace builder then falls back to the legacy per-namespace
		// detection), matching the prior nil-factory behaviour.
		tracker.synced.Store(true)
		return tracker
	}

	tracker.source = ingestManager
	tracker.registerWorkloadIngest(ingestManager, DeploymentGVR, resourceDeployment)
	tracker.registerWorkloadIngest(ingestManager, StatefulSetGVR, resourceStateful)
	tracker.registerWorkloadIngest(ingestManager, DaemonSetGVR, resourceDaemon)
	tracker.registerWorkloadIngest(ingestManager, JobGVR, resourceJob)
	tracker.registerWorkloadIngest(ingestManager, CronJobGVR, resourceCronJob)
	tracker.registerPodIngest(ingestManager)

	return tracker
}

// registerWorkloadIngest wires one cut workload kind's presence from the ingest manager: a
// whole-bundle Sink feeds add/delete (upsert from the WorkloadSummary Table half, delete from
// the Catalog half's namespace/name — the workload store drops the Table half), and the kind's
// store HasSynced joins the tracker's sync gate — exactly as the typed informer's handler +
// HasSynced did before the cut. A nil manager / unregistered kind is a no-op.
func (t *NamespaceWorkloadTracker) registerWorkloadIngest(ingestManager trackerPodIngestSource, gvr schema.GroupVersionResource, resource workloadResource) {
	if ingestManager == nil {
		return
	}
	if ingestManager.AddBundleSink(gvr, trackerWorkloadSink{tracker: t, resource: resource}) {
		t.syncFns = append(t.syncFns, func() bool { return ingestManager.HasSyncedFor(gvr) })
		t.tracked = append(t.tracked, trackedWorkloadKind{gvr: gvr, resource: resource})
	}
}

// registerPodIngest wires the pod kind's presence from the ingest manager: a Table-half
// Sink feeds add/delete keyed off the projected PodSummary (namespace/name), and the pod
// store's HasSynced joins the tracker's sync gate, exactly as the pod informer's handler
// + HasSynced did before the cut. A nil manager is a no-op.
func (t *NamespaceWorkloadTracker) registerPodIngest(ingestManager trackerPodIngestSource) {
	if ingestManager == nil {
		return
	}
	if ingestManager.AddSink(PodGVR, trackerPodSink{tracker: t}) {
		t.syncFns = append(t.syncFns, func() bool { return ingestManager.HasSyncedFor(PodGVR) })
		t.tracked = append(t.tracked, trackedWorkloadKind{gvr: PodGVR, resource: resourcePod})
	}
}

// trackerPodSink adapts the tracker's per-namespace pod presence to an ingest Table-half
// Sink: each Upsert/Delete carries the projected PodSummary, from which the pod's
// namespace and "namespace/name" key are read — the same key the typed-pod event path
// derived via meta.Accessor.
type trackerPodSink struct {
	tracker *NamespaceWorkloadTracker
}

func (s trackerPodSink) Upsert(row interface{}) {
	if pod, ok := row.(streamrows.PodSummary); ok {
		s.tracker.addNamespaceKey(resourcePod, pod.Namespace, pod.Namespace+"/"+pod.Name)
	}
}

func (s trackerPodSink) Delete(row interface{}) {
	if pod, ok := row.(streamrows.PodSummary); ok {
		s.tracker.deleteNamespaceKey(resourcePod, pod.Namespace, pod.Namespace+"/"+pod.Name)
	}
}

// trackerWorkloadSink adapts the tracker's per-namespace workload presence to an ingest
// whole-bundle Sink for one cut workload kind: UpsertBundle reads the WorkloadSummary Table
// half's namespace/name; DeleteBundle reads the Catalog half's namespace/name (the workload
// store drops the Table half from its stored bundle, so the delete cannot read it there) —
// the same "namespace/name" key the typed-workload event path derived via meta.Accessor.
type trackerWorkloadSink struct {
	tracker  *NamespaceWorkloadTracker
	resource workloadResource
}

func (s trackerWorkloadSink) UpsertBundle(b ingest.Bundle) {
	if w, ok := b.Table.(streamrows.WorkloadSummary); ok {
		s.tracker.addNamespaceKey(s.resource, w.Namespace, w.Namespace+"/"+w.Name)
	}
}

func (s trackerWorkloadSink) DeleteBundle(b ingest.Bundle) {
	if summary, ok := b.Catalog.(objectcatalog.Summary); ok {
		s.tracker.deleteNamespaceKey(s.resource, summary.Namespace, summary.Namespace+"/"+summary.Name)
	}
}

// WaitForSync blocks until all registered ingest stores have synced or the context is cancelled.
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
	synced := cache.WaitForCacheSync(ctx.Done(), t.syncFns...)
	if synced {
		// Seed the baseline from the now-synced stores before latching synced, so a store
		// restored from a cooled-cluster spill (which set synced=true without replaying its
		// rows to the sinks) still contributes its workloads. Idempotent: any row already
		// delivered through the incremental sinks is a keyed no-op here.
		t.seedOnce.Do(t.seedFromStores)
		t.synced.Store(true)
	}
	return synced
}

// seedFromStores rebuilds the per-namespace workload-presence baseline from each tracked
// kind's current ingest rows. It reads the Catalog half (an objectcatalog.Summary carries
// namespace/name for every cut kind) so one path seeds both pods and the five workload
// kinds. The incremental sinks keep the counts live afterward; this only supplies the
// baseline a restored (no-fan) store never delivered. Adds are keyed and idempotent.
func (t *NamespaceWorkloadTracker) seedFromStores() {
	if t.source == nil {
		return
	}
	for _, tracked := range t.tracked {
		for _, row := range t.source.CatalogRows(tracked.gvr) {
			summary, ok := row.(objectcatalog.Summary)
			if !ok || summary.Namespace == "" {
				continue
			}
			t.addNamespaceKey(tracked.resource, summary.Namespace, summary.Namespace+"/"+summary.Name)
		}
	}
}

// HasWorkloads reports whether workloads are known for the namespace and if the information is reliable.
func (t *NamespaceWorkloadTracker) HasWorkloads(namespace string) (bool, bool) {
	if t == nil {
		return false, false
	}
	if namespace == "" {
		return false, true
	}
	if !t.synced.Load() {
		return false, false
	}
	t.mu.RLock()
	state, ok := t.namespaces[namespace]
	if !ok {
		t.mu.RUnlock()
		return false, true
	}
	has := state.hasWorkloads()
	known := !state.unknown
	t.mu.RUnlock()
	return has, known
}

// MarkUnknown flags the namespace as having unreliable workload information.
func (t *NamespaceWorkloadTracker) MarkUnknown(namespace string) {
	if t == nil || namespace == "" {
		return
	}
	t.mu.Lock()
	state := t.ensureNamespaceLocked(namespace)
	state.unknown = true
	t.mu.Unlock()
}

// addNamespaceKey records one object's presence in a namespace by its already-resolved
// namespace and key. The cut kinds' ingest sinks deliver a projected row (not a typed
// object), so they resolve namespace/key from the row itself and feed it here.
func (t *NamespaceWorkloadTracker) addNamespaceKey(resource workloadResource, namespace, key string) {
	if namespace == "" {
		return
	}
	t.mu.Lock()
	state := t.ensureNamespaceLocked(namespace)
	if state.add(resource, key) {
		state.unknown = false
	}
	t.mu.Unlock()
}

// deleteNamespaceKey removes one object's presence by its already-resolved namespace and
// key — fed by the cut kinds' ingest sinks, which resolve namespace/key from the projected
// row.
func (t *NamespaceWorkloadTracker) deleteNamespaceKey(resource workloadResource, namespace, key string) {
	if namespace == "" {
		return
	}
	t.mu.Lock()
	state, exists := t.namespaces[namespace]
	if !exists {
		state = &namespaceState{unknown: true}
		t.namespaces[namespace] = state
		t.mu.Unlock()
		return
	}
	if !state.remove(resource, key) {
		state.unknown = true
	} else if !state.shouldRetain() {
		delete(t.namespaces, namespace)
	}
	t.mu.Unlock()
}

func (t *NamespaceWorkloadTracker) ensureNamespaceLocked(namespace string) *namespaceState {
	if state, ok := t.namespaces[namespace]; ok && state != nil {
		return state
	}
	state := &namespaceState{
		objects: make(map[workloadResource]map[string]struct{}),
	}
	t.namespaces[namespace] = state
	return state
}
