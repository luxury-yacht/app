package ingest

import (
	"context"
	"slices"
	"sync"
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/internal/lifecycle"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
)

// DynamicCatalogSpec identifies the API source, including the CRD incarnation
// when known. Empty DefinitionUID denotes a promoted source without a known CRD.
type DynamicCatalogSpec struct {
	GVR           schema.GroupVersionResource
	GVK           schema.GroupVersionKind
	Namespaced    bool
	DefinitionUID types.UID
}

type dynamicSource struct {
	spec       DynamicCatalogSpec
	namespaces []string
	generation uint64
	cancel     context.CancelFunc
	done       chan struct{}
	retired    atomic.Bool
}

type dynamicAdmission struct {
	spec       DynamicCatalogSpec
	client     dynamic.Interface
	namespaces []string
	filter     func(string, string, string) bool
	runDone    <-chan struct{}
	sink       Sink
}

// SetDynamicCatalogSink configures generation-owned cache invalidation before
// Start. Store writes deliver this sink before notifying catalog consumers.
func (m *IngestManager) SetDynamicCatalogSink(sink Sink) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.dynamicCatalogSink = sink
}

// ReconcileDynamicCatalogSource makes this specification the active source for
// its GroupResource. Unchanged specifications retain their running reflectors.
// API permission checks and cancellation joins never hold the manager lock.
func (m *IngestManager) ReconcileDynamicCatalogSource(spec DynamicCatalogSpec, project CatalogProjector) bool {
	if project == nil || spec.GVR.Resource == "" || spec.GVR.Version == "" || spec.GVK.Kind == "" || spec.GVR.GroupVersion() != spec.GVK.GroupVersion() {
		return false
	}
	request := m.beginDynamicAdmission(spec)
	if request == nil {
		return false
	}
	return m.completeDynamicAdmission(request, project)
}

func (m *IngestManager) completeDynamicAdmission(request *dynamicAdmission, project CatalogProjector) bool {
	allowed := make([]string, 0, len(request.namespaces))
	for _, namespace := range request.namespaces {
		if ingestNamespacePermitted(request.spec.GVR, namespace, request.filter) {
			allowed = append(allowed, namespace)
		}
	}
	if !m.dynamicAdmissionNeedsReplacement(request, allowed) {
		return false
	}
	e := m.prepareDynamicEntry(request, project, allowed)
	ctx, previous, admitted := m.admitDynamicEntry(request, e)
	if !admitted {
		return false
	}
	if previous != nil {
		previous.dynamic.cancel()
	}
	go runDynamicEntry(ctx, e, previous)
	return true
}

// Compare the desired source before allocating stores and reflectors. Permission
// reviews run outside both the definition and lifecycle locks.
func (m *IngestManager) dynamicAdmissionNeedsReplacement(request *dynamicAdmission, allowed []string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	gr := request.spec.GVR.GroupResource()
	if m.dynamicAdmissions[gr] != request || m.runDone != request.runDone || lifecycle.Context(request.runDone).Err() != nil {
		return false
	}
	if dynamicEntryNeedsReplacement(m.entryForGroupResourceLocked(gr), &dynamicSource{spec: request.spec, namespaces: allowed}) {
		return true
	}
	delete(m.dynamicAdmissions, gr)
	return false
}

func (m *IngestManager) beginDynamicAdmission(spec DynamicCatalogSpec) *dynamicAdmission {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.dynamic == nil || m.runDone == nil || lifecycle.Context(m.runDone).Err() != nil {
		return nil
	}
	if current := m.entryForGroupResourceLocked(spec.GVR.GroupResource()); current != nil && !current.onDemand.Load() {
		return nil
	}
	namespaces := []string{""}
	if spec.Namespaced && len(m.scope) > 0 {
		namespaces = slices.Clone(m.scope)
	}
	request := &dynamicAdmission{spec: spec, client: m.dynamic, namespaces: namespaces, filter: m.permissionFilter, runDone: m.runDone, sink: m.dynamicCatalogSink}
	if m.dynamicAdmissions == nil {
		m.dynamicAdmissions = make(map[schema.GroupResource]*dynamicAdmission)
	}
	m.dynamicAdmissions[spec.GVR.GroupResource()] = request
	return request
}

func (m *IngestManager) prepareDynamicEntry(request *dynamicAdmission, project CatalogProjector, allowed []string) *entry {
	spec := request.spec
	e := &entry{gvr: spec.GVR, store: newIngestProjectingStore(catalogProjectionFor(project))}
	e.store.AddCatalogSink(request.sink)
	e.onDemand.Store(true)
	example := &unstructuredv1.Unstructured{}
	example.SetGroupVersionKind(spec.GVK)
	for _, namespace := range request.namespaces {
		if !slices.Contains(allowed, namespace) {
			part := &ingestPart{namespace: namespace}
			part.skipped.Store(true)
			e.parts = append(e.parts, part)
			continue
		}
		e.addPartition(spec.GVK, namespace, dynamicListWatch(request.client, spec.GVR, namespace), example, func(row interface{}, deleted bool) { m.notifyDynamicSource(e, row, deleted) })
	}
	e.store.SetExpectedPartitions(allowed)
	e.dynamic = &dynamicSource{spec: spec, namespaces: allowed, done: make(chan struct{})}
	return e
}

func (m *IngestManager) admitDynamicEntry(request *dynamicAdmission, e *entry) (context.Context, *entry, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	gr := request.spec.GVR.GroupResource()
	if m.dynamicAdmissions[gr] != request {
		return nil, nil, false
	}
	delete(m.dynamicAdmissions, gr)
	if m.runDone != request.runDone || lifecycle.Context(request.runDone).Err() != nil {
		return nil, nil, false
	}
	previous := m.entryForGroupResourceLocked(gr)
	if !dynamicEntryNeedsReplacement(previous, e.dynamic) {
		return nil, nil, false
	}
	ctx, cancel := context.WithCancel(lifecycle.Context(request.runDone))
	m.dynamicGeneration++
	e.dynamic.generation = m.dynamicGeneration
	e.dynamic.cancel = cancel
	if previous != nil {
		previous.dynamic.retired.Store(true)
		delete(m.entries, previous.gvr)
	}
	m.entries[e.gvr] = e
	return ctx, previous, true
}

func dynamicEntryNeedsReplacement(previous *entry, desired *dynamicSource) bool {
	if previous == nil {
		return true
	}
	if previous.dynamic == nil {
		return false
	}
	return previous.dynamic.retired.Load() || previous.dynamic.spec != desired.spec || !slices.Equal(previous.dynamic.namespaces, desired.namespaces)
}

func (m *IngestManager) entryForGroupResourceLocked(gr schema.GroupResource) *entry {
	for gvr, e := range m.entries {
		if gvr.GroupResource() == gr {
			return e
		}
	}
	return nil
}

func runDynamicEntry(ctx context.Context, e, previous *entry) {
	defer close(e.dynamic.done)
	// Evict cached responses for the retired source before its successor starts.
	defer func() { _ = e.store.Replace(nil, "") }()
	if previous != nil {
		// Joining the predecessor is required even if this generation was itself
		// replaced: the successor's join must cover the entire retirement chain.
		<-previous.dynamic.done
	}
	if ctx.Err() != nil {
		return
	}
	var workers sync.WaitGroup
	for _, part := range e.parts {
		if part.skipped.Load() {
			continue
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			runIngestPartition(ctx, part)
		}()
	}
	workers.Wait()
}

func (m *IngestManager) joinDynamicRetirement(e *entry) {
	e.dynamic.cancel()
	<-e.dynamic.done
	m.mu.Lock()
	var listeners []*dynamicSubscription
	if m.entries[e.gvr] == e {
		delete(m.entries, e.gvr)
		listeners = m.dynamicListenersLocked()
	}
	m.mu.Unlock()
	// Consumers reread after taking publication ownership. If a replacement
	// arrived meanwhile, they read it instead of applying this retired baseline.
	for _, listener := range listeners {
		listener.deliver(DynamicCatalogChange{Source: e.dynamic.spec, Generation: e.dynamic.generation})
	}
}

// DynamicCatalogSnapshot includes only partitions whose initial LIST completed.
// Missing partitions still require catalog LIST collection, including LIST-only
// namespaces that deliberately have no reflector.
type DynamicCatalogSnapshot struct {
	Spec            DynamicCatalogSpec
	Generation      uint64
	ReadyNamespaces []string
	Rows            []interface{}
}

func (m *IngestManager) ReadDynamicCatalogSource(gr schema.GroupResource) (DynamicCatalogSnapshot, bool) {
	m.mu.Lock()
	e := m.entryForGroupResourceLocked(gr)
	m.mu.Unlock()
	if e == nil || e.dynamic == nil || e.dynamic.retired.Load() {
		return DynamicCatalogSnapshot{}, false
	}
	rows, ready := e.store.catalogPartitionSnapshot()
	if e.dynamic.retired.Load() {
		return DynamicCatalogSnapshot{}, false
	}
	return DynamicCatalogSnapshot{Spec: e.dynamic.spec, Generation: e.dynamic.generation, ReadyNamespaces: ready, Rows: rows}, true
}

// SubscribeDynamicCatalogChanges delivers source identities after store writes
// finish. Consumers reread current state instead of retaining event payloads.
func (m *IngestManager) SubscribeDynamicCatalogChanges(listener func(DynamicCatalogChange)) func() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if listener == nil || m.stopped {
		return func() {}
	}
	if m.dynamicListeners == nil {
		m.dynamicListeners = make(map[uint64]*dynamicSubscription)
	}
	m.nextDynamicListener++
	id := m.nextDynamicListener
	subscription := &dynamicSubscription{listener: listener}
	m.dynamicListeners[id] = subscription
	return func() {
		m.mu.Lock()
		delete(m.dynamicListeners, id)
		m.mu.Unlock()
		subscription.stop()
	}
}

func (m *IngestManager) notifyDynamicSource(e *entry, row interface{}, deleted bool) {
	m.mu.Lock()
	current := m.entryForGroupResourceLocked(e.gvr.GroupResource())
	var listeners []*dynamicSubscription
	if current == e && !e.dynamic.retired.Load() {
		listeners = m.dynamicListenersLocked()
	}
	m.mu.Unlock()
	for _, listener := range listeners {
		listener.deliver(DynamicCatalogChange{Source: e.dynamic.spec, Generation: e.dynamic.generation, Row: row, Deleted: deleted})
	}
}

func (m *IngestManager) dynamicListenersLocked() []*dynamicSubscription {
	listeners := make([]*dynamicSubscription, 0, len(m.dynamicListeners))
	for _, listener := range m.dynamicListeners {
		listeners = append(listeners, listener)
	}
	return listeners
}

// A nil Row requests a baseline reread (initial LIST or relist); object changes
// carry the already-projected row so ordinary updates remain incremental.
type DynamicCatalogChange struct {
	Source     DynamicCatalogSpec
	Generation uint64
	Row        interface{}
	Deleted    bool
}

func (m *IngestManager) IsDynamicCatalogGeneration(gr schema.GroupResource, generation uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entryForGroupResourceLocked(gr)
	return e != nil && e.dynamic != nil && !e.dynamic.retired.Load() && e.dynamic.generation == generation
}
