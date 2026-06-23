package snapshot

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/api/meta"
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

// trackerPodIngestSource supplies the cut pod kind's presence to the workload tracker:
// an incremental Table-half Sink (each Upsert/Delete carries the pod's PodSummary, from
// which the tracker reads namespace/name) plus the pod store's HasSynced gate. The shared
// informer no longer caches pods, so the tracker reads pod presence here instead of the
// pod informer. *ingest.IngestManager satisfies it.
type trackerPodIngestSource interface {
	AddSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
}

// NewNamespaceWorkloadTracker wires informer event handlers that keep namespace workload
// counts updated. Pods is cut to the ingest path, so pod presence comes from the pod
// reflector's Table-half Sink (and its HasSynced gate) rather than the pod informer.
// ingestManager may be nil (a unit test), in which case pods contribute no presence.
func NewNamespaceWorkloadTracker(factory informers.SharedInformerFactory, ingestManager trackerPodIngestSource) *NamespaceWorkloadTracker {
	tracker := newNamespaceWorkloadTracker()
	if factory == nil {
		tracker.synced.Store(true)
		return tracker
	}

	tracker.registerInformer(factory.Apps().V1().Deployments().Informer(), resourceDeployment)
	tracker.registerInformer(factory.Apps().V1().StatefulSets().Informer(), resourceStateful)
	tracker.registerInformer(factory.Apps().V1().DaemonSets().Informer(), resourceDaemon)
	tracker.registerInformer(factory.Batch().V1().Jobs().Informer(), resourceJob)
	tracker.registerInformer(factory.Batch().V1().CronJobs().Informer(), resourceCronJob)
	tracker.registerPodIngest(ingestManager)

	return tracker
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

func (t *NamespaceWorkloadTracker) registerInformer(inf cache.SharedIndexInformer, resource workloadResource) {
	if inf == nil {
		return
	}
	t.syncFns = append(t.syncFns, inf.HasSynced)
	inf.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			t.handleAdd(obj, resource)
		},
		UpdateFunc: func(_, newObj interface{}) {
			t.handleAdd(newObj, resource)
		},
		DeleteFunc: func(obj interface{}) {
			t.handleDelete(obj, resource)
		},
	})
}

// WaitForSync blocks until all registered informers have synced or the context is cancelled.
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
		t.synced.Store(true)
	}
	return synced
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

func (t *NamespaceWorkloadTracker) handleAdd(obj interface{}, resource workloadResource) {
	namespace, key, ok := extractNamespaceAndKey(obj)
	if !ok || namespace == "" {
		return
	}
	t.addNamespaceKey(resource, namespace, key)
}

// addNamespaceKey records one object's presence in a namespace by its already-resolved
// namespace and key. It is the shared core of both the typed-informer event path
// (handleAdd) and the pod ingest sink (which delivers a projected row, not a typed
// object, so it resolves namespace/key from the row itself).
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

func (t *NamespaceWorkloadTracker) handleDelete(obj interface{}, resource workloadResource) {
	namespace, key, ok := extractNamespaceAndKey(obj)
	if !ok || namespace == "" {
		return
	}
	t.deleteNamespaceKey(resource, namespace, key)
}

// deleteNamespaceKey removes one object's presence by its already-resolved namespace and
// key — the shared core of the typed-informer delete path and the pod ingest sink.
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

func extractNamespaceAndKey(obj interface{}) (string, string, bool) {
	if obj == nil {
		return "", "", false
	}
	switch v := obj.(type) {
	case cache.DeletedFinalStateUnknown:
		return extractNamespaceAndKey(v.Obj)
	case *cache.DeletedFinalStateUnknown:
		return extractNamespaceAndKey(v.Obj)
	}
	accessor, err := meta.Accessor(obj)
	if err != nil {
		return "", "", false
	}
	namespace := accessor.GetNamespace()
	name := accessor.GetName()
	if namespace == "" || name == "" {
		return "", "", false
	}
	return namespace, namespace + "/" + name, true
}
