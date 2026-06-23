/*
 * backend/refresh/ingest/manager.go
 *
 * IngestManager owns the owned-reflector ingestion path for one cluster: a
 * ProjectingStore + ProjectingReflector per built-in streamed kind, replacing
 * what the typed SharedInformerFactory does today — but holding ONLY projected
 * stream Summaries, never the typed object. It is generic over the kind registry:
 * it loops kindregistry.StreamDescriptors(), and the only per-group code is the
 * finite group/version -> RESTClient mapping every typed informer needs anyway.
 *
 * This package is NOT wired into any live path; a later step cuts consumers over.
 */

package ingest

import (
	"context"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
	gatewayscheme "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/scheme"
)

// gatewayGroup is the API group whose example objects and REST client come from
// the Gateway API client rather than the core kube client.
const gatewayGroup = "gateway.networking.k8s.io"

// apiextensionsGroup is the API group served by the apiextensions client.
const apiextensionsGroup = "apiextensions.k8s.io"

// CatalogProjector projects a reflector-decoded object to its object-catalog row.
// It is supplied per kind by the catalog so the catalog half of the bundle is
// built at intake, alongside the table half, from one ingestion.
type CatalogProjector func(obj metav1.Object) interface{}

// ObjectMapProjector projects a reflector-decoded object to its object-map graph
// node. It is supplied per kind (built from the kind's descriptor collector + edges)
// so the object-map half of the bundle is built at intake. The clusterID is closed
// over from the manager's meta so the projector matches the object-map's signature.
type ObjectMapProjector func(obj metav1.Object) interface{}

// entry is one ingested kind: the reflector that drives intake and the store
// that holds its projected rows.
type entry struct {
	desc      streamspec.Descriptor
	store     *ProjectingStore
	reflector *ProjectingReflector

	// catalogProject, when set, builds the bundle's Catalog half for this kind.
	// It is registered before Start via RegisterCatalogProjector and read by the
	// store's projection; nil leaves the Catalog half nil.
	catalogProject CatalogProjector

	// objectMapProject, when set, builds the bundle's ObjectMap half for this kind.
	// It is registered before Start via RegisterObjectMapProjector and read by the
	// store's projection; nil leaves the ObjectMap half nil.
	objectMapProject ObjectMapProjector
}

// IngestManager owns one ProjectingStore + ProjectingReflector per built-in
// streamed kind for a single cluster. The stores hold projected stream Summaries
// (the StreamRow output), never the typed objects the reflector decodes.
type IngestManager struct {
	meta    streamrows.ClusterMeta
	kube    kubernetes.Interface
	apiext  apiextensionsclientset.Interface
	gateway gatewayversioned.Interface

	entries map[schema.GroupVersionResource]*entry

	mu     sync.Mutex
	cancel context.CancelFunc
}

// NewIngestManager builds an IngestManager for the cluster identified by meta,
// mirroring the clients the informer factory takes. apiext and gateway may be
// nil; descriptors whose group has no available client are skipped (logged
// once), as are descriptors whose GVK the client-go (or Gateway API) scheme does
// not know. It builds — but does not start — a reflector + store per remaining
// kind. Start runs them.
func NewIngestManager(
	meta streamrows.ClusterMeta,
	kube kubernetes.Interface,
	apiext apiextensionsclientset.Interface,
	gateway gatewayversioned.Interface,
) *IngestManager {
	m := &IngestManager{
		meta:    meta,
		kube:    kube,
		apiext:  apiext,
		gateway: gateway,
		entries: make(map[schema.GroupVersionResource]*entry),
	}
	for _, desc := range kindregistry.StreamDescriptors() {
		m.addDescriptor(desc)
	}
	return m
}

// addDescriptor builds the reflector + projecting store for one streamed kind.
// It skips (logging once) a descriptor whose group has no available client or
// whose GVK the scheme cannot instantiate, so a nil Gateway client or an unknown
// kind never panics or blocks the rest.
func (m *IngestManager) addDescriptor(desc streamspec.Descriptor) {
	gvr := schema.GroupVersionResource{Group: desc.Group, Version: desc.Version, Resource: desc.Resource}
	gvk := schema.GroupVersionKind{Group: desc.Group, Version: desc.Version, Kind: desc.Kind}

	restClient, ok := m.restClientFor(desc.Group, desc.Version)
	if !ok {
		klog.V(2).Infof("ingest: no client for %s/%s (kind %s); skipping (logged once)", desc.Group, desc.Version, desc.Kind)
		return
	}
	example, ok := exampleObjectFor(gvk)
	if !ok {
		klog.V(2).Infof("ingest: scheme does not know %s; skipping (logged once)", gvk.String())
		return
	}

	e := &entry{desc: desc}
	e.store = NewProjectingStore(projectionFor(m.meta, e))
	m.installReflector(e, gvr, gvk, restClient, example)
}

// installReflector wires the ListWatch + reflector for an already-built entry whose
// store is set, then registers the entry under gvr. It is the shared tail of both the
// generic descriptor path (addDescriptor) and the bespoke-projector path
// (RegisterReflector), so the ListWatch/WatchList wiring lives in exactly one place.
func (m *IngestManager) installReflector(e *entry, gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, restClient rest.Interface, example apiruntime.Object) {
	lw := cache.NewListWatchFromClient(restClient, gvr.Resource, metav1.NamespaceAll, fields.Everything())
	// ToListWatcherWithWatchListSemantics lets the reflector use WatchList when the
	// client advertises support and fall back to LIST+WATCH otherwise — exactly as
	// the generated informers do. The client argument is the typed group client so
	// its WatchList capability is detected.
	wrapped := cache.ToListWatcherWithWatchListSemantics(lw, restClient)
	e.reflector = NewProjectingReflector(gvk.String(), wrapped, example, e.store, resyncDisabled)
	m.entries[gvr] = e
}

// RegisterReflector builds a reflector + projecting store for a kind that is NOT a
// directly-streamed descriptor (it has no streamspec.Descriptor in the registry), so
// NewIngestManager's StreamDescriptors loop never adds it. The pod kind uses this: its
// row projection needs a ReplicaSet lister and produces a four-half Bundle (PodSummary
// Table + PodAggregate + catalog Summary + object-map node) the generic StreamRow
// projection cannot express. project is the kind's full bundle projector. It must be
// called before Start so the reflector is included when reflectors launch. It is a
// no-op (returns false) when the kind's group has no client, the scheme cannot
// instantiate its GVK, or an entry for gvr already exists (the generic loop already
// added it — preventing a double reflector).
func (m *IngestManager) RegisterReflector(gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, project ProjectFunc) bool {
	restClient, ok := m.restClientFor(gvk.Group, gvk.Version)
	if !ok {
		klog.V(2).Infof("ingest: no client for %s/%s (kind %s); skipping reflector (logged once)", gvk.Group, gvk.Version, gvk.Kind)
		return false
	}
	example, ok := exampleObjectFor(gvk)
	if !ok {
		klog.V(2).Infof("ingest: scheme does not know %s; skipping reflector (logged once)", gvk.String())
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.entries[gvr]; exists {
		return false
	}
	e := &entry{store: NewProjectingStore(project)}
	m.installReflector(e, gvr, gvk, restClient, example)
	return true
}

// projectionFor returns the ProjectFunc for an entry: it asserts the
// reflector-decoded object to metav1.Object, runs the kind's StreamRow for the
// bundle's Table half, and runs the entry's catalog projector (when registered)
// for the Catalog half — so one ingestion serves both consumers and the store
// keeps only the bundle, never the typed object. The concrete type assertion
// lives in the kind package's StreamRow closure; the manager handles only
// metav1.Object.
func projectionFor(meta streamrows.ClusterMeta, e *entry) ProjectFunc {
	streamRow := e.desc.StreamRow
	return func(obj interface{}) (interface{}, error) {
		m, err := metaObjectOf(obj)
		if err != nil {
			return nil, err
		}
		bundle := Bundle{Table: streamRow(meta, m)}
		if e.catalogProject != nil {
			bundle.Catalog = e.catalogProject(m)
		}
		if e.objectMapProject != nil {
			bundle.ObjectMap = e.objectMapProject(m)
		}
		return bundle, nil
	}
}

// metaObjectOf asserts obj to metav1.Object, the only shape the projection needs.
func metaObjectOf(obj interface{}) (metav1.Object, error) {
	m, ok := obj.(metav1.Object)
	if !ok {
		return nil, &notMetaObjectError{obj: obj}
	}
	return m, nil
}

type notMetaObjectError struct{ obj interface{} }

func (e *notMetaObjectError) Error() string {
	return "ingest: reflector decoded an object that is not a metav1.Object"
}

// restClientFor maps a descriptor's API group/version to the matching typed group
// client's RESTClient. This is the one finite, group-keyed switch the design
// allows: every typed informer builds its ListWatch from exactly this client.
// It returns false when no client is available for the group (e.g. a nil Gateway
// or apiextensions client), so the caller skips that kind.
func (m *IngestManager) restClientFor(group, version string) (rest.Interface, bool) {
	switch group {
	case "":
		return m.kube.CoreV1().RESTClient(), true
	case "apps":
		return m.kube.AppsV1().RESTClient(), true
	case "batch":
		return m.kube.BatchV1().RESTClient(), true
	case "rbac.authorization.k8s.io":
		return m.kube.RbacV1().RESTClient(), true
	case "discovery.k8s.io":
		return m.kube.DiscoveryV1().RESTClient(), true
	case "storage.k8s.io":
		return m.kube.StorageV1().RESTClient(), true
	case "networking.k8s.io":
		return m.kube.NetworkingV1().RESTClient(), true
	case "policy":
		return m.kube.PolicyV1().RESTClient(), true
	case "admissionregistration.k8s.io":
		return m.kube.AdmissionregistrationV1().RESTClient(), true
	case "autoscaling":
		// Descriptors carry the concrete version (autoscaling/v1 or v2); honour it
		// so the reflector queries the version the kind registered.
		if version == "v2" {
			return m.kube.AutoscalingV2().RESTClient(), true
		}
		return m.kube.AutoscalingV1().RESTClient(), true
	case apiextensionsGroup:
		if m.apiext == nil {
			return nil, false
		}
		return m.apiext.ApiextensionsV1().RESTClient(), true
	case gatewayGroup:
		if m.gateway == nil {
			return nil, false
		}
		return m.gateway.GatewayV1().RESTClient(), true
	default:
		return nil, false
	}
}

// exampleObjectFor instantiates the empty typed object for gvk from the client-go
// scheme, falling back to the Gateway API scheme for Gateway kinds the client-go
// scheme does not know. It reports false when no scheme knows the GVK, so the
// caller skips that kind rather than feeding the reflector an untyped example.
func exampleObjectFor(gvk schema.GroupVersionKind) (apiruntime.Object, bool) {
	if obj, err := clientgoscheme.Scheme.New(gvk); err == nil {
		return obj, true
	}
	if gvk.Group == gatewayGroup {
		if obj, err := gatewayscheme.Scheme.New(gvk); err == nil {
			return obj, true
		}
	}
	return nil, false
}

// Start runs every reflector on a goroutine bound to a context derived from ctx.
// Both Stop and cancelling ctx wind the reflectors down. Start is idempotent per
// manager: a second call is a no-op once reflectors are running.
func (m *IngestManager) Start(ctx context.Context) {
	m.mu.Lock()
	if m.cancel != nil {
		m.mu.Unlock()
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	entries := make([]*entry, 0, len(m.entries))
	for _, e := range m.entries {
		entries = append(entries, e)
	}
	m.mu.Unlock()

	for _, e := range entries {
		e := e
		go e.reflector.Run(runCtx)
	}
}

// Stop cancels every running reflector. It is safe to call when Start was never
// called or after a previous Stop.
func (m *IngestManager) Stop() {
	m.mu.Lock()
	cancel := m.cancel
	m.cancel = nil
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// HasSynced reports whether every kind's store has completed its initial relist.
// It is true only once all reflectors have populated their stores, mirroring the
// informer factory's HasSynced readiness gate.
func (m *IngestManager) HasSynced() bool {
	m.mu.Lock()
	entries := make([]*entry, 0, len(m.entries))
	for _, e := range m.entries {
		entries = append(entries, e)
	}
	m.mu.Unlock()
	for _, e := range entries {
		if !e.store.HasSynced() {
			return false
		}
	}
	return true
}

// StoreFor returns the ProjectingStore holding the projected rows for gvr, or nil
// when the manager has no entry for that resource (its kind was skipped or is not
// a built-in streamed kind).
func (m *IngestManager) StoreFor(gvr schema.GroupVersionResource) *ProjectingStore {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.entries[gvr]; ok {
		return e.store
	}
	return nil
}

// RegisterCatalogProjector sets the catalog projector for gvr so the store builds
// the bundle's Catalog half from each intake. It is a no-op when the manager has
// no entry for gvr. It must be called before Start so every object — including the
// initial relist — carries the catalog half. Reports whether an entry was found.
func (m *IngestManager) RegisterCatalogProjector(gvr schema.GroupVersionResource, project CatalogProjector) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[gvr]
	if !ok {
		return false
	}
	e.catalogProject = project
	return true
}

// RegisterObjectMapProjector sets the object-map projector for gvr so the store
// builds the bundle's ObjectMap half from each intake. It is a no-op when the
// manager has no entry for gvr. It must be called before Start so every object —
// including the initial relist — carries the object-map half. Reports whether an
// entry was found.
func (m *IngestManager) RegisterObjectMapProjector(gvr schema.GroupVersionResource, project ObjectMapProjector) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[gvr]
	if !ok {
		return false
	}
	e.objectMapProject = project
	return true
}

// AddSink registers a Table-half sink for gvr's store so a consumer (a maintained
// store, a response-cache invalidator) is fed incrementally as the reflector
// mutates it. Multiple sinks may be registered per gvr. It is a no-op when the
// manager has no entry for gvr. It must be called before Start so no mutation is
// missed. Reports whether an entry was found.
func (m *IngestManager) AddSink(gvr schema.GroupVersionResource, sink Sink) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[gvr]
	if !ok {
		return false
	}
	e.store.AddSink(sink)
	return true
}

// AddBundleSink registers a whole-Bundle sink for gvr's store so a consumer that needs
// more than one bundle half of the same object (the pod live-stream notify) is fed both
// halves together as the reflector mutates it. It is a no-op when the manager has no
// entry for gvr. It must be called before Start so no mutation is missed. Reports whether
// an entry was found.
func (m *IngestManager) AddBundleSink(gvr schema.GroupVersionResource, sink BundleSink) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[gvr]
	if !ok {
		return false
	}
	e.store.AddBundleSink(sink)
	return true
}

// AddCatalogSink registers a Catalog-half sink for gvr's store so the object catalog
// is fed the kind's Summary incrementally as the reflector mutates it, without
// reading the shared informer. It is a no-op when the manager has no entry for gvr.
// It must be called before Start so no mutation is missed. Reports whether an entry
// was found.
func (m *IngestManager) AddCatalogSink(gvr schema.GroupVersionResource, sink Sink) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[gvr]
	if !ok {
		return false
	}
	e.store.AddCatalogSink(sink)
	return true
}

// TableRows returns the Table half of every projected row for gvr (the
// directly-streamed/summary-table rows), or nil when the manager has no entry for
// gvr.
func (m *IngestManager) TableRows(gvr schema.GroupVersionResource) []interface{} {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.TableRows()
}

// CatalogRows returns the Catalog half of every projected row for gvr (the
// object-catalog Summaries), or nil when the manager has no entry for gvr or no
// catalog projector was registered.
func (m *IngestManager) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.CatalogRows()
}

// ObjectMapRows returns the ObjectMap half of every projected row for gvr (the
// object-map graph nodes), or nil when the manager has no entry for gvr or no
// object-map projector was registered.
func (m *IngestManager) ObjectMapRows(gvr schema.GroupVersionResource) []interface{} {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.ObjectMapRows()
}

// AggregateRows returns the Aggregate half of every projected row for gvr (a kind's
// bespoke aggregation rows — the pod kind's PodAggregate), or nil when the manager has
// no entry for gvr or no aggregate half was projected.
func (m *IngestManager) AggregateRows(gvr schema.GroupVersionResource) []interface{} {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.AggregateRows()
}

// Rows returns the full projected value of every object in gvr's store — the per-object
// Bundle (or table-only projection) — in ONE consistent locked read, or nil when the
// manager has no entry for gvr. A consumer that needs more than one bundle half for the
// SAME object (the workloads domain reading a pod's Table and Aggregate halves together)
// reads here rather than pairing separate TableRows/AggregateRows calls, which could
// desync across a concurrent reflector mutation.
func (m *IngestManager) Rows(gvr schema.GroupVersionResource) []interface{} {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.List()
}

// StoreResourceVersion returns the latest list/watch resourceVersion gvr's store has
// observed (from its relist or a watch bookmark), or "" when the manager has no entry
// for gvr. It is the ingest equivalent of the highest object resourceVersion a typed
// lister would expose: for a kind whose objects share one cluster-wide RV counter (the
// core group), it advances on every add/update/delete the reflector sees, so a snapshot
// domain can fold it into its monotonic version watermark in place of the per-object RV
// it can no longer read from the dropped typed objects.
func (m *IngestManager) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	store := m.StoreFor(gvr)
	if store == nil {
		return ""
	}
	return store.LastStoreSyncResourceVersion()
}

// HasSyncedFor reports whether gvr's store has completed its initial relist, or
// false when the manager has no entry for gvr. Consumers that read only specific
// GVRs (the catalog reading the quotas kinds) gate on these rather than the
// whole-manager HasSynced.
func (m *IngestManager) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	store := m.StoreFor(gvr)
	if store == nil {
		return false
	}
	return store.HasSynced()
}

// resyncDisabled documents that ingest reflectors run with no periodic resync:
// the store is always current, and a relist only happens on watch expiry/error.
// It exists so the 0 passed to NewProjectingReflector reads as a deliberate
// choice rather than a magic number.
const resyncDisabled = time.Duration(0)
