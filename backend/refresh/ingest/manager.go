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
 * Beyond the descriptor reflectors it also hosts the on-demand dynamic (CRD-backed)
 * reflectors the catalog promotes at runtime (RegisterDynamicCatalogReflector), which use
 * the dynamic client and are excluded from the readiness gate — so the one ingest path
 * serves both built-in cut kinds and dynamically-discovered custom resources.
 */

package ingest

import (
	"context"
	"encoding/gob"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
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
	desc  streamspec.Descriptor
	store *ProjectingStore

	// parts are the kind's reflectors: one per configured scope namespace for
	// a namespaced kind under a namespace scope (docs/plans/namespace-scope.md),
	// or a single cluster-wide "" part otherwise — the unscoped path is the
	// same code with a one-element list. All parts feed the ONE shared store
	// through per-namespace partition views.
	parts []*ingestPart

	// example is the empty typed object for this kind, retained so registerGobTypes can
	// project it through the store's projection to discover (and gob.Register) the concrete
	// Bundle-half types the spill encodes — types the ingest package cannot import directly.
	example apiruntime.Object

	// catalogProject, when set, builds the bundle's Catalog half for this kind.
	// It is registered before Start via RegisterCatalogProjector and read by the
	// store's projection; nil leaves the Catalog half nil.
	catalogProject CatalogProjector

	// objectMapProject, when set, builds the bundle's ObjectMap half for this kind.
	// It is registered before Start via RegisterObjectMapProjector and read by the
	// store's projection; nil leaves the ObjectMap half nil.
	objectMapProject ObjectMapProjector

	// degraded latches true when this kind's store has not synced within the manager's
	// sync deadline, so a single never-syncing reflector (RBAC denial, hung WatchList,
	// projection error) is excluded from the readiness gate instead of blocking it
	// forever — mirroring the informer factory's per-informer degrade (issue #225,
	// informer/factory.go stateSettled). The reflector keeps retrying LIST+WATCH in the
	// background, so the store still delivers data if it later syncs.
	degraded atomic.Bool

	// onDemand marks a reflector added lazily AFTER Start for a dynamic (CRD-backed) kind
	// the catalog promoted on demand (RegisterDynamicCatalogReflector). On-demand entries
	// are EXCLUDED from the whole-manager HasSynced gate — they are added once the cluster
	// already serves, so they must not perturb readiness or the metrics poller that gate
	// blocks (the issue-#225 class) — while HasSyncedFor still reports their real per-gvr
	// sync so the catalog can serve-when-synced-else-LIST.
	onDemand atomic.Bool

	// cancel stops just this entry's reflectors. It is set only for on-demand reflectors,
	// which launch on a context derived from the manager's run context so StopReflectorFor
	// can tear one down without stopping the rest. Descriptor reflectors run directly on
	// the run context and leave this nil.
	cancel context.CancelFunc
}

// ingestPart is one reflector of an entry: the cluster-wide "" part, or one
// configured namespace's part under a namespace scope. Each part writes the
// shared store through its own partition view, so its relists fully define
// only its own partition.
type ingestPart struct {
	namespace string
	lw        cache.ListerWatcher
	reflector *ProjectingReflector
	view      *StorePartitionView

	// resumeRV, when set (RestoreStores, before Start), makes Start attempt a
	// delta resume of THIS part's watch from the persisted resourceVersion
	// before the reflector's full sync. Empty launches the reflector directly.
	resumeRV string

	// skipped latches true when Start declines to launch this part because the
	// permission filter reports the identity cannot list/watch the kind in the
	// part's namespace. A skipped part is excluded from the store's expected
	// partitions, so one denied namespace never blanks or blocks the others.
	skipped atomic.Bool
}

// allPartsSkipped reports whether every part of the entry was
// permission-skipped — the per-kind "permanently empty for this identity"
// state PermissionSkippedFor exposes.
func (e *entry) allPartsSkipped() bool {
	if len(e.parts) == 0 {
		return false
	}
	for _, part := range e.parts {
		if !part.skipped.Load() {
			return false
		}
	}
	return true
}

// IngestManager owns one ProjectingStore + ProjectingReflector per built-in
// streamed kind for a single cluster. The stores hold projected stream Summaries
// (the StreamRow output), never the typed objects the reflector decodes.
type IngestManager struct {
	meta    streamrows.ClusterMeta
	kube    kubernetes.Interface
	apiext  apiextensionsclientset.Interface
	gateway gatewayversioned.Interface
	// dynamic serves the on-demand dynamic (CRD-backed) reflectors the catalog promotes at
	// runtime (RegisterDynamicCatalogReflector). It is optional (SetDynamicClient) because
	// only that path needs it — the descriptor reflectors use the typed group clients
	// (restClientFor). nil leaves the on-demand path disabled.
	dynamic dynamic.Interface

	entries map[schema.GroupVersionResource]*entry

	mu     sync.Mutex
	cancel context.CancelFunc
	// runCtx is the context Start derived for the running reflectors, retained so a
	// reflector registered AFTER Start (an on-demand dynamic reflector) can launch on the
	// same lifetime — Stop or cancelling Start's ctx winds it down with the rest. nil
	// before Start and after Stop.
	runCtx context.Context

	// syncDeadline bounds how long a kind's store may take to complete its initial
	// relist before it is degraded out of the readiness gate (so one never-syncing
	// reflector cannot wedge the whole cluster's readiness). Measured from startedAt,
	// which Start stamps once. now is the clock, injectable in tests.
	syncDeadline time.Duration
	now          func() time.Time
	startedAtMu  sync.Mutex
	startedAt    time.Time

	// permissionFilter, when set, reports whether the identity may list+watch a kind
	// in the given namespace ("" = cluster-wide). Start skips (does not launch) any
	// part it returns false for, so a denied kind — or a single denied namespace of a
	// scoped kind — is excluded from readiness immediately rather than 403-retrying
	// for the whole sync deadline. nil leaves every reflector enabled (the default for
	// tests and any caller that does not gate on permissions).
	permissionFilter func(group, resource, namespace string) bool

	// scope is the cluster's configured namespace scope
	// (docs/plans/namespace-scope.md); empty means cluster-wide reflectors.
	scope []string
	// namespacedGVR reports which registry kinds are namespaced, so only those
	// fan out over the scope; cluster-scoped kinds always keep one "" part.
	namespacedGVR map[schema.GroupVersionResource]bool
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
	allowedNamespaces ...string,
) *IngestManager {
	namespaced := make(map[schema.GroupVersionResource]bool)
	for _, d := range kindregistry.All {
		namespaced[d.Identity.GVR()] = d.Identity.Namespaced
	}
	m := &IngestManager{
		meta:          meta,
		kube:          kube,
		apiext:        apiext,
		gateway:       gateway,
		entries:       make(map[schema.GroupVersionResource]*entry),
		syncDeadline:  config.RefreshInformerSyncDeadline,
		now:           time.Now,
		scope:         append([]string(nil), allowedNamespaces...),
		namespacedGVR: namespaced,
	}
	for _, desc := range kindregistry.StreamDescriptors() {
		m.addDescriptor(desc)
	}
	return m
}

// partitionNamespaces returns the namespaces gvr's reflectors run in: the
// configured scope for a namespaced kind under a namespace scope, otherwise
// the single cluster-wide "" — the unscoped degenerate of the same loop.
func (m *IngestManager) partitionNamespaces(gvr schema.GroupVersionResource) []string {
	if len(m.scope) == 0 || !m.namespacedGVR[gvr] {
		return []string{""}
	}
	return append([]string(nil), m.scope...)
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

// installReflector wires the per-namespace ListWatches + reflectors for an
// already-built entry whose store is set, then registers the entry under gvr.
// It is the shared tail of both the generic descriptor path (addDescriptor)
// and the bespoke-projector path (RegisterReflector), so the ListWatch/
// WatchList wiring lives in exactly one place. Unscoped (or cluster-scoped
// kinds) build a single cluster-wide part; a namespace scope fans one part
// per configured namespace, each writing its own store partition.
func (m *IngestManager) installReflector(e *entry, gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, restClient rest.Interface, example apiruntime.Object) {
	e.example = example
	for _, namespace := range m.partitionNamespaces(gvr) {
		lw := cache.NewListWatchFromClient(restClient, gvr.Resource, namespace, fields.Everything())
		// ToListWatcherWithWatchListSemantics lets the reflector use WatchList when the
		// client advertises support and fall back to LIST+WATCH otherwise — exactly as
		// the generated informers do. The client argument is the typed group client so
		// its WatchList capability is detected.
		wrapped := cache.ToListWatcherWithWatchListSemantics(lw, restClient)
		name := gvk.String()
		if namespace != "" {
			name += " ns=" + namespace
		}
		view := e.store.PartitionView(namespace)
		e.parts = append(e.parts, &ingestPart{
			namespace: namespace,
			lw:        wrapped,
			reflector: NewProjectingReflector(name, wrapped, example, view, resyncDisabled),
			view:      view,
		})
	}
	m.entries[gvr] = e
}

// RegisterReflector builds a reflector + projecting store for a kind that is NOT a
// directly-streamed descriptor (it has no streamspec.Descriptor in the registry), so
// NewIngestManager's StreamDescriptors loop never adds it. The pod kind uses this: its
// row projection needs a ReplicaSet lister and produces a four-half Bundle (PodSummary
// Table + PodAggregate + catalog Summary + object-map node) the generic StreamRow
// projection cannot express. project is the kind's full bundle projector. retainTable keeps
// the Bundle's Table half in the STORED row (pods read the stored Table half for standalone
// synthesis + live notify); every other reflector passes false so the redundant Table half
// is dropped once fanned to the maintained store. It must be called before Start so the
// reflector is included when reflectors launch. It is a no-op (returns false) when the
// kind's group has no client, the scheme cannot instantiate its GVK, or an entry for gvr
// already exists (the generic loop already added it — preventing a double reflector).
func (m *IngestManager) RegisterReflector(gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, project ProjectFunc, retainTable bool) bool {
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
	store := NewProjectingStore(project)
	store.SetRetainTable(retainTable)
	e := &entry{store: store}
	m.installReflector(e, gvr, gvk, restClient, example)
	return true
}

// RegisterDynamicCatalogReflector starts an on-demand reflector for a dynamic
// (CRD-backed) kind: it LIST+WATCHes the kind's custom resources through the dynamic
// client and projects each (decoded as *unstructured.Unstructured) to its object-catalog
// row via project, wrapped as the Bundle's Catalog half so CatalogRows serves it. It is
// the consolidation of the catalog's former on-demand promotion informer into the one
// ingest path: the catalog calls it when a CR kind crosses its promotion threshold.
// Unlike the descriptor reflectors it launches immediately on the manager's run context
// (it is registered after Start) and is EXCLUDED from the whole-manager readiness gate
// (see entry.onDemand). It returns false when no dynamic client is set, the manager is not
// started, or an entry for gvr already exists.
func (m *IngestManager) RegisterDynamicCatalogReflector(gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, project CatalogProjector, namespaced bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.dynamic == nil || m.runCtx == nil {
		return false
	}
	if _, exists := m.entries[gvr]; exists {
		return false
	}
	e := &entry{store: NewProjectingStore(catalogProjectionFor(project))}
	e.onDemand.Store(true)
	example := &unstructuredv1.Unstructured{}
	example.SetGroupVersionKind(gvk)
	// A CRD-backed kind is not in the built-in registry, so its scope
	// fan-out is decided by the caller-supplied namespaced flag.
	namespaces := []string{""}
	if namespaced && len(m.scope) > 0 {
		namespaces = append([]string(nil), m.scope...)
	}
	for _, namespace := range namespaces {
		name := gvk.String()
		if namespace != "" {
			name += " ns=" + namespace
		}
		view := e.store.PartitionView(namespace)
		lw := dynamicListWatch(m.dynamic, gvr, namespace)
		e.parts = append(e.parts, &ingestPart{
			namespace: namespace,
			lw:        lw,
			reflector: NewProjectingReflector(name, lw, example, view, resyncDisabled),
			view:      view,
		})
	}
	e.store.SetExpectedPartitions(namespaces)
	m.entries[gvr] = e
	ctx, cancel := context.WithCancel(m.runCtx)
	e.cancel = cancel
	for _, part := range e.parts {
		go part.reflector.Run(ctx)
	}
	return true
}

// StopReflectorFor stops and evicts the reflector for gvr — the teardown half of the
// on-demand dynamic path (the catalog drops a promoted CR kind on shutdown). It cancels
// only that entry's reflector (on-demand entries carry their own cancel) and removes it,
// so the manager no longer serves or reports the gvr. It is a no-op when no entry exists.
func (m *IngestManager) StopReflectorFor(gvr schema.GroupVersionResource) {
	m.mu.Lock()
	e, ok := m.entries[gvr]
	if ok {
		delete(m.entries, gvr)
	}
	m.mu.Unlock()
	if ok && e.cancel != nil {
		e.cancel()
	}
}

// dynamicListWatch builds a ListerWatcher over the dynamic client for gvr in
// namespace ("" = all namespaces) — the on-demand dynamic-CRD equivalent of the
// typed ListWatch NewListWatchFromClient builds in installReflector. The
// reflector decodes results as *unstructured.Unstructured, which the catalog
// projection consumes as a metav1.Object. context.Background mirrors
// NewListWatchFromClient: the reflector stops the returned watch.Interface on
// ctx-cancel, so the watch is wound down without a per-call context.
func dynamicListWatch(client dynamic.Interface, gvr schema.GroupVersionResource, namespace string) cache.ListerWatcher {
	if namespace == "" {
		namespace = metav1.NamespaceAll
	}
	resource := client.Resource(gvr).Namespace(namespace)
	return &cache.ListWatch{
		ListFunc: func(options metav1.ListOptions) (apiruntime.Object, error) {
			return resource.List(context.Background(), options)
		},
		WatchFunc: func(options metav1.ListOptions) (watch.Interface, error) {
			options.Watch = true
			return resource.Watch(context.Background(), options)
		},
	}
}

// catalogProjectionFor adapts a CatalogProjector to a ProjectFunc yielding a Bundle that
// carries only the Catalog half, so an on-demand reflector's store serves its rows through
// CatalogRows exactly as the descriptor reflectors' catalog half does.
func catalogProjectionFor(project CatalogProjector) ProjectFunc {
	return func(obj interface{}) (interface{}, error) {
		m, err := metaObjectOf(obj)
		if err != nil {
			return nil, err
		}
		return Bundle{Catalog: project(m)}, nil
	}
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
		if e.desc.AggregateRow != nil {
			bundle.Aggregate = e.desc.AggregateRow(m)
		}
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

// SetPermissionFilter installs the predicate Start uses to decide whether to launch
// each part's reflector (namespace "" = cluster-wide). It must be called before
// Start. A nil filter (the default) launches every reflector. See permissionFilter.
func (m *IngestManager) SetPermissionFilter(fn func(group, resource, namespace string) bool) {
	m.mu.Lock()
	m.permissionFilter = fn
	m.mu.Unlock()
}

// SetDynamicClient installs the dynamic client used for on-demand dynamic (CRD-backed)
// reflectors (RegisterDynamicCatalogReflector). It must be set before the first such
// registration. A nil client (the default) leaves the on-demand path disabled, so
// RegisterDynamicCatalogReflector returns false and the catalog keeps listing the kind.
func (m *IngestManager) SetDynamicClient(dyn dynamic.Interface) {
	m.mu.Lock()
	m.dynamic = dyn
	m.mu.Unlock()
}

// Start runs every permitted reflector on a goroutine bound to a context derived from
// ctx. Both Stop and cancelling ctx wind the reflectors down. Start is idempotent per
// manager: a second call is a no-op once reflectors are running. A kind the permission
// filter denies is marked skipped (settled, empty store) and its reflector is not
// launched.
func (m *IngestManager) Start(ctx context.Context) {
	type launchEntry struct {
		gvr schema.GroupVersionResource
		e   *entry
	}
	m.mu.Lock()
	if m.cancel != nil {
		m.mu.Unlock()
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.runCtx = runCtx
	filter := m.permissionFilter
	entries := make([]launchEntry, 0, len(m.entries))
	for gvr, e := range m.entries {
		entries = append(entries, launchEntry{gvr: gvr, e: e})
	}
	m.mu.Unlock()

	// Stamp the readiness deadline from a single moment, so a kind whose initial
	// relist never completes degrades out of the gate rather than blocking it.
	m.startedAtMu.Lock()
	m.startedAt = m.now()
	m.startedAtMu.Unlock()

	for _, le := range entries {
		le := le
		// Permission-skip per part: a kind (or a single scoped namespace of a
		// kind) the identity cannot list/watch never launches its reflector
		// (which would only 403-retry); it is excluded from the store's
		// expected partitions so it does not block readiness — one denied
		// namespace never blanks or blocks the others, mirroring the factory
		// excluding a denied informer.
		launched := make([]string, 0, len(le.e.parts))
		for _, part := range le.e.parts {
			if filter != nil && !filter(le.gvr.Group, le.gvr.Resource, part.namespace) {
				part.skipped.Store(true)
				if part.namespace == "" {
					klog.V(2).Infof("ingest: skipping %s — identity cannot list/watch it (logged once)", le.gvr)
				} else {
					klog.V(2).Infof("ingest: skipping %s in %q — identity cannot list/watch it there (logged once)", le.gvr, part.namespace)
				}
				continue
			}
			launched = append(launched, part.namespace)
		}
		// Expected partitions must be declared BEFORE any reflector of the
		// entry runs, so the store's sync gate counts exactly the launched set.
		le.e.store.SetExpectedPartitions(launched)
		for _, part := range le.e.parts {
			if part.skipped.Load() {
				continue
			}
			part := part
			// Resume from a persisted resourceVersion when one was set (the store was
			// restored full from disk); otherwise — the default — this is exactly
			// part.reflector.Run.
			go runWithResume(runCtx, part.lw, part.view, part.resumeRV, func() { part.reflector.Run(runCtx) })
		}
	}

	// One log line when the initial syncs settle, naming the slowest kinds — the
	// per-kind cold-start telemetry (see InitialSyncDurations).
	go m.logInitialSyncSummary(runCtx)
}

// SetResumeResourceVersion records the resourceVersion gvr's reflector should resume its
// WATCH from on Start, instead of a full re-sync — the cold-start delta-resume path. It must
// be called before Start, and only when gvr's store has been restored full from disk (a
// resume on an empty store would leave it holding only the deltas since rv). It is a no-op
// (returns false) when the manager has no entry for gvr or rv is empty.
func (m *IngestManager) SetResumeResourceVersion(gvr schema.GroupVersionResource, rv string) bool {
	if rv == "" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[gvr]
	if !ok {
		return false
	}
	// The legacy single-RV resume applies to the cluster-wide part; scoped
	// parts resume from their per-partition RVs (RestoreStores).
	for _, part := range e.parts {
		if part.namespace == "" {
			part.resumeRV = rv
			return true
		}
	}
	return false
}

// registerGobTypes gob-registers the concrete Bundle-half types every entry projects, by
// projecting each entry's example object through its store projection and registering each
// non-nil half. The ingest package cannot import those types (they live in consumer packages
// that import ingest), so it registers them from the runtime projection value instead. It is
// idempotent (re-registering a type is a no-op) and fully recover()-guarded: a kind whose
// zero-object projection panics or whose type conflicts is simply left unregistered, so its
// SpillBundles fails and it falls back to a full sync — never a crash.
func (m *IngestManager) registerGobTypes() {
	m.mu.Lock()
	entries := make([]*entry, 0, len(m.entries))
	for _, e := range m.entries {
		entries = append(entries, e)
	}
	m.mu.Unlock()
	for _, e := range entries {
		registerEntryGobTypes(e)
	}
}

func registerEntryGobTypes(e *entry) {
	defer func() { _ = recover() }()
	if e.example == nil || e.store == nil {
		return
	}
	projected, err := e.store.project(e.example)
	if err != nil {
		return
	}
	b, ok := projected.(Bundle)
	if !ok {
		return
	}
	gobRegisterIfNonNil(b.Table)
	gobRegisterIfNonNil(b.Catalog)
	gobRegisterIfNonNil(b.ObjectMap)
	gobRegisterIfNonNil(b.Aggregate)
}

func gobRegisterIfNonNil(v interface{}) {
	if v == nil {
		return
	}
	defer func() { _ = recover() }() // gob.Register panics on a name conflict; ignore it
	gob.Register(v)
}

// SpillStores writes every (non-on-demand) entry's store to a per-GVR file under dir, so a
// restart can restore the full projected state and resume each watch from the persisted RV.
// It registers the projected types first. Best-effort: a per-store failure (an unregistered
// type) is collected and the rest still spill, so one bad kind only forgoes its own delta
// resume. On-demand dynamic reflectors are skipped (they are not resumed).
func (m *IngestManager) SpillStores(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("ingest: spill mkdir %q: %w", dir, err)
	}
	m.registerGobTypes()
	m.mu.Lock()
	type gvrEntry struct {
		gvr schema.GroupVersionResource
		e   *entry
	}
	entries := make([]gvrEntry, 0, len(m.entries))
	for gvr, e := range m.entries {
		entries = append(entries, gvrEntry{gvr: gvr, e: e})
	}
	m.mu.Unlock()
	var errs []error
	for _, ge := range entries {
		if ge.e.onDemand.Load() {
			continue
		}
		if err := ge.e.store.SpillBundles(filepath.Join(dir, ingestSpillFileName(ge.gvr))); err != nil {
			errs = append(errs, fmt.Errorf("spill %s: %w", ge.gvr, err))
		}
	}
	return errors.Join(errs...)
}

// RestoreStores restores each (non-on-demand) entry's store from its per-GVR file under dir
// and, on success, sets the entry's resumeRV so Start resumes that kind's watch from the
// persisted RV instead of a full re-LIST. It registers the projected types first. Best-effort
// and safe-by-default: a missing/corrupt file or an unregistered type leaves resumeRV empty,
// so that kind full-syncs. Must be called before Start.
func (m *IngestManager) RestoreStores(dir string) {
	m.registerGobTypes()
	m.mu.Lock()
	defer m.mu.Unlock()
	for gvr, e := range m.entries {
		if e.onDemand.Load() {
			continue
		}
		rv, partitionRVs, err := e.store.RestoreBundles(filepath.Join(dir, ingestSpillFileName(gvr)))
		if err != nil {
			continue
		}
		for _, part := range e.parts {
			if part.namespace == "" {
				// Legacy cluster-wide resume: the store-level RV.
				part.resumeRV = rv
				continue
			}
			// A scoped part resumes only from ITS namespace's persisted RV; a
			// missing entry (scope changed since the spill) means full sync.
			part.resumeRV = partitionRVs[part.namespace]
		}
	}
}

// ingestSpillFileName renders a filesystem-safe per-GVR spill file name. The core group's
// empty string becomes "core"; group/version/resource are otherwise dot-safe.
func ingestSpillFileName(gvr schema.GroupVersionResource) string {
	group := gvr.Group
	if group == "" {
		group = "core"
	}
	return group + "." + gvr.Version + "." + gvr.Resource + ".bundles"
}

// Stop cancels every running reflector. It is safe to call when Start was never
// called or after a previous Stop.
func (m *IngestManager) Stop() {
	m.mu.Lock()
	cancel := m.cancel
	m.cancel = nil
	m.runCtx = nil
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// HasSynced reports whether every kind's store has SETTLED — synced or degraded past
// the sync deadline. It is the readiness gate the composite hub blocks on; gating it
// on raw sync alone let a single never-syncing reflector (RBAC denial, hung WatchList,
// projection error) wedge the whole subsystem's readiness — and, because Manager.Start
// blocks on it before starting the metrics poller, wedge metrics too. The deadline
// degrade mirrors the informer factory's stateSettled (issue #225).
func (m *IngestManager) HasSynced() bool {
	m.mu.Lock()
	entries := make([]*entry, 0, len(m.entries))
	for _, e := range m.entries {
		entries = append(entries, e)
	}
	m.mu.Unlock()
	for _, e := range entries {
		if e.onDemand.Load() {
			// On-demand dynamic reflectors are added after the cluster is already serving;
			// they must not gate (or un-settle) the whole-manager readiness the metrics
			// poller waits on. Their readiness is observed per-gvr via HasSyncedFor.
			continue
		}
		if !m.entrySettled(e) {
			return false
		}
	}
	return true
}

// entrySettled reports whether one kind's store has stopped gating readiness: it has
// synced, or it has been marked degraded, or it has exceeded the sync deadline without
// syncing (flipped to degraded here, logged once). A degraded store keeps retrying
// LIST+WATCH in the background, so HasSynced still reflects a later real sync — the
// degrade only stops it BLOCKING the initial gate.
func (m *IngestManager) entrySettled(e *entry) bool {
	if e.allPartsSkipped() {
		// Permission-skipped: reflector never launched, store stays empty; settled so it
		// does not block readiness (the domain serves degraded for this kind).
		return true
	}
	if e.store.HasSynced() {
		return true
	}
	if e.degraded.Load() {
		return true
	}
	if m.syncDeadlineExceeded() {
		// The CAS only elects the one caller that logs; a caller that LOSES the
		// race (a concurrent evaluation degraded the entry first) must still
		// report settled — the entry IS degraded either way. Folding the CAS
		// into the settled decision made a raced HasSynced return a false
		// negative, which can block Manager.Start's readiness wait.
		if e.degraded.CompareAndSwap(false, true) {
			klog.Warningf("ingest store for %s did not sync within the deadline — marking degraded and excluding from readiness (LIST+WATCH retries continue in the background)", e.desc.GVR())
		}
		return true
	}
	return false
}

// syncDeadlineExceeded reports whether the per-cluster ingest sync deadline has passed
// since Start stamped startedAt. A zero startedAt (Start not yet called) or a
// non-positive deadline never fires, so the deadline can only degrade a store after the
// reflectors have actually been given the chance to run.
func (m *IngestManager) syncDeadlineExceeded() bool {
	if m.syncDeadline <= 0 {
		return false
	}
	m.startedAtMu.Lock()
	startedAt := m.startedAt
	m.startedAtMu.Unlock()
	if startedAt.IsZero() {
		return false
	}
	return m.now().Sub(startedAt) > m.syncDeadline
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
	e, ok := m.entries[gvr]
	m.mu.Unlock()
	if !ok {
		return false
	}
	// Outside the manager lock: the store call acquires the store's write lock, and a
	// store's sink delivery may legally call back into the manager (the pods notify
	// sink does) — holding both wedged the whole ingest layer (ABBA deadlock, see
	// TestSinkRegistrationDoesNotDeadlockWithSinkManagerCallback). The manager mutex
	// is a leaf lock: it guards the entries map only and is never held across a store
	// call. e.store is set once at entry construction and never reassigned, so the
	// pointer stays valid after unlock.
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
	e, ok := m.entries[gvr]
	m.mu.Unlock()
	if !ok {
		return false
	}
	// Store call outside the manager lock — see AddSink for the leaf-lock rule.
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
	e, ok := m.entries[gvr]
	m.mu.Unlock()
	if !ok {
		return false
	}
	// Store call outside the manager lock — see AddSink for the leaf-lock rule. This
	// is the wrapper that wedged production: the catalog registers its sinks right
	// after a failed initial sync, racing the pods reflector's initial Replace whose
	// bundle sink calls back into the manager (goroutines-20260701-152259 dump).
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

// RowsByIndex returns the full projected values whose Bundle index includes one of
// the supplied values under indexName, or nil when the manager has no entry for gvr.
func (m *IngestManager) RowsByIndex(gvr schema.GroupVersionResource, indexName string, values []string) []interface{} {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.RowsByIndex(indexName, values)
}

// RewriteBundlesByIndex applies rewrite to gvr's stored bundles reachable through
// indexName/values — the out-of-band projection correction path (the pod owner
// heal; see ProjectingStore.RewriteBundlesByIndex) — and returns the new bundles,
// or nil when the manager has no entry for gvr. The store call runs outside the
// manager lock (StoreFor resolves the entry under the leaf mutex): the rewrite's
// sink delivery may legally call back into the manager, exactly like a reflector
// mutation — see AddSink for the leaf-lock rule.
func (m *IngestManager) RewriteBundlesByIndex(
	gvr schema.GroupVersionResource,
	indexName string,
	values []string,
	rewrite func(Bundle) (Bundle, bool),
) []Bundle {
	store := m.StoreFor(gvr)
	if store == nil {
		return nil
	}
	return store.RewriteBundlesByIndex(indexName, values, rewrite)
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

// Tracks reports whether the manager has an entry (a registered reflector + store) for gvr.
// A consumer that waits on per-GVR sync uses this to avoid blocking on a kind the manager has
// no entry for — whose HasSyncedFor is false forever (an unavailable client/scheme at
// registration), which would otherwise wedge a wait-for-all-synced gate.
func (m *IngestManager) Tracks(gvr schema.GroupVersionResource) bool {
	m.mu.Lock()
	_, ok := m.entries[gvr]
	m.mu.Unlock()
	return ok
}

// HasSyncedFor reports whether gvr's store has SETTLED — synced or degraded past the
// sync deadline (see entrySettled) — or false when the manager has no entry for gvr.
// Consumers that read only specific GVRs (the catalog reading the quotas kinds, the
// cut domains' per-GVR ResourcesSettled gate) use this rather than the whole-manager
// HasSynced, so one stuck kind degrades only the domains that need it.
func (m *IngestManager) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	m.mu.Lock()
	e, ok := m.entries[gvr]
	m.mu.Unlock()
	if !ok {
		return false
	}
	if e.onDemand.Load() {
		// On-demand reflectors are excluded from the deadline-degrade (the catalog falls
		// back to LIST until they sync, so there is nothing to degrade); report the raw
		// store sync directly.
		return e.store.HasSynced()
	}
	return m.entrySettled(e)
}

// RawHasSyncedFor reports whether gvr's store has completed an actual initial
// sync. Unlike HasSyncedFor it does not treat deadline degradation as data
// availability, so aggregate consumers can distinguish loading from unavailable.
func (m *IngestManager) RawHasSyncedFor(gvr schema.GroupVersionResource) bool {
	store := m.StoreFor(gvr)
	return store != nil && store.HasSynced()
}

// PermissionSkippedFor reports whether gvr's reflector was permission-skipped at Start —
// the identity cannot list+watch the kind, so its store is settled but PERMANENTLY empty
// for this identity (until a rebuild re-evaluates permissions). Consumers use this to
// mark the kind's data as permission-unavailable instead of rendering silent zeros; it is
// deliberately distinct from deadline-degrade, which is a liveness state, not a
// permission state. False for untracked GVRs and before Start.
func (m *IngestManager) PermissionSkippedFor(gvr schema.GroupVersionResource) bool {
	m.mu.Lock()
	e, ok := m.entries[gvr]
	m.mu.Unlock()
	if !ok {
		return false
	}
	return e.allPartsSkipped()
}

// resyncDisabled documents that ingest reflectors run with no periodic resync:
// the store is always current, and a relist only happens on watch expiry/error.
// It exists so the 0 passed to NewProjectingReflector reads as a deliberate
// choice rather than a magic number.
const resyncDisabled = time.Duration(0)

// InitialSyncDurations reports, per tracked GVR, how long the kind's initial relist
// took from Start to the store's first sync. Kinds that have not synced (skipped,
// degraded, still listing) are absent. It exists to answer, from a live run, WHICH
// kinds dominate the cold-start window — the per-kind relist telemetry the startup
// perf work needs before any transport-level parallelization is attempted.
func (m *IngestManager) InitialSyncDurations() map[schema.GroupVersionResource]time.Duration {
	m.startedAtMu.Lock()
	startedAt := m.startedAt
	m.startedAtMu.Unlock()
	if startedAt.IsZero() {
		return nil
	}
	m.mu.Lock()
	stores := make(map[schema.GroupVersionResource]*ProjectingStore, len(m.entries))
	for gvr, e := range m.entries {
		stores[gvr] = e.store
	}
	m.mu.Unlock()
	// Leaf-lock rule: store reads happen outside m.mu.
	out := make(map[schema.GroupVersionResource]time.Duration, len(stores))
	for gvr, store := range stores {
		if syncedAt := store.SyncedAt(); !syncedAt.IsZero() && syncedAt.After(startedAt) {
			out[gvr] = syncedAt.Sub(startedAt)
		}
	}
	return out
}

// logInitialSyncSummary logs ONE per-cluster line naming the slowest initial relists
// once the manager settles, so a live run can identify the kinds that dominate the
// first-connect window without a debugger. It exits quietly when ctx ends first.
func (m *IngestManager) logInitialSyncSummary(ctx context.Context) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for !m.HasSynced() {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
	durations := m.InitialSyncDurations()
	type kindDuration struct {
		gvr schema.GroupVersionResource
		d   time.Duration
	}
	sorted := make([]kindDuration, 0, len(durations))
	for gvr, d := range durations {
		sorted = append(sorted, kindDuration{gvr: gvr, d: d})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].d > sorted[j].d })
	const maxNamed = 8
	parts := make([]string, 0, maxNamed)
	for i, kd := range sorted {
		if i == maxNamed {
			break
		}
		parts = append(parts, fmt.Sprintf("%s=%dms", kd.gvr.Resource, kd.d.Milliseconds()))
	}
	klog.Infof("ingest initial sync settled for cluster %s: %d kind(s) synced; slowest: %s",
		m.meta.ClusterName, len(durations), strings.Join(parts, " "))
}
