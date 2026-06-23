package informer

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	grpcroutepkg "github.com/luxury-yacht/app/backend/resources/grpcroute"
	httproutepkg "github.com/luxury-yacht/app/backend/resources/httproute"
	tlsroutepkg "github.com/luxury-yacht/app/backend/resources/tlsroute"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"

	"golang.org/x/sync/errgroup"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resources/common"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

// Factory wraps the shared informer factory used by the refresh subsystem.
type Factory struct {
	kubeClient     kubernetes.Interface
	apiextFactory  apiextinformers.SharedInformerFactory
	gatewayFactory gatewayinformers.SharedInformerFactory
	resync         time.Duration

	once     sync.Once
	factory  informers.SharedInformerFactory
	synced   bool
	syncedMu sync.RWMutex

	// syncDeadline bounds how long a single informer may take to sync after Start
	// before it is marked degraded and excluded from the readiness gate. startedAt
	// records when Start began so the deadline is measured from a single moment.
	syncDeadline time.Duration
	startedAt    time.Time
	startedAtMu  sync.RWMutex

	syncStates   []*informerSyncState
	shutdown     bool
	syncStatesMu sync.Mutex

	pendingClusterInformers []clusterInformerRegistration

	// permissionAllowed tracks permission keys that have been allowed at least once.
	permissionAllowed map[string]struct{}
	permissionMu      sync.RWMutex

	runtimePermissions *permissions.Checker

	// helmStorage is the label-filtered (owner=helm) informer set over Secrets and
	// ConfigMaps that holds the FULL typed helm-release objects. ConfigMap/Secret are
	// cut to the ingest path so the shared factory no longer caches them as typed
	// objects; this dedicated source serves the three helm consumers that still need
	// the typed object. nil before New finishes wiring it.
	helmStorage *HelmStorageSource
}

// informerSyncState tracks one informer's progress toward its initial sync.
// terminal flips when the watch fails with an error that can never succeed,
// so the informer stops blocking the sync gates. degraded flips when the
// informer has neither synced nor gone terminal within the sync deadline —
// for example a WatchList stream whose terminal bookmark was stripped, which
// never reports HasSynced. A degraded informer is excluded from the readiness
// gates and logged once, while it keeps retrying in the background. key is the
// canonical resource identity (permissions.ResourceKey format) used for
// per-resource readiness checks.
type informerSyncState struct {
	key       string
	hasSynced cache.InformerSynced
	terminal  atomic.Bool
	degraded  atomic.Bool
}

// CanListResource reports whether the current identity can list the supplied resource.
func (f *Factory) CanListResource(group, resource string) (bool, error) {
	if f == nil {
		return false, fmt.Errorf("informer factory not initialised")
	}
	return f.checkResourceVerb(group, resource, "list")
}

// CanWatchResource reports whether the current identity can watch the supplied resource.
func (f *Factory) CanWatchResource(group, resource string) (bool, error) {
	if f == nil {
		return false, fmt.Errorf("informer factory not initialised")
	}
	return f.checkResourceVerb(group, resource, "watch")
}

// CanListWatch reports whether the current identity can both list and watch the resource.
// Returns false if either permission is denied or if checking fails.
func (f *Factory) CanListWatch(group, resource string) bool {
	if f == nil {
		return false
	}
	listAllowed, listErr := f.CanListResource(group, resource)
	if listErr != nil || !listAllowed {
		return false
	}
	watchAllowed, watchErr := f.CanWatchResource(group, resource)
	if watchErr != nil || !watchAllowed {
		return false
	}
	return true
}

// New returns a new informer Factory with the provided resync period.
// The checker is used for all permission (SSAR) checks; it must not be nil.
func New(client kubernetes.Interface, apiextClient apiextensionsclientset.Interface, resync time.Duration, checker *permissions.Checker) *Factory {
	if checker == nil {
		panic("informer.New: permissions checker must not be nil")
	}
	if resync <= 0 {
		resync = config.RefreshResyncInterval
	}
	// Projection-at-intake: strip managedFields before any object enters the cache.
	kubeFactory := informers.NewSharedInformerFactoryWithOptions(client, resync, informers.WithTransform(StripManagedFields))
	result := &Factory{
		kubeClient:         client,
		resync:             resync,
		factory:            kubeFactory,
		syncDeadline:       config.RefreshInformerSyncDeadline,
		permissionAllowed:  make(map[string]struct{}),
		runtimePermissions: checker,
	}
	// nodes is an owned-reflector ingest kind (IngestOwned): the typed node informer is never
	// instantiated. Node has no Stream descriptor (its table is the bespoke NodeSummary whose
	// row joins per-node pod aggregates + metrics), so the system wires a bespoke node reflector
	// (snapshot.NewNodeIngestProjector) that projects the OWN-fields NodeSummary + an overview
	// fact at intake. Every node consumer reads the ingest projections instead: the nodes domain
	// (own-rows + serve-side pod-aggregate/metrics re-join), cluster-overview (overview facts),
	// the object catalog, the object map, and the resource-stream notify (Catalog-half sink).
	//
	// pods is an owned-reflector ingest kind (IngestOwned): the typed pod informer is
	// never instantiated. Every pod consumer reads the ingest projections instead (the
	// pods maintained store, the cluster-overview/nodes/namespace-workloads aggregation,
	// the namespace workload tracker, the object catalog, the object map, the
	// response-cache invalidator). The ReplicaSet informer below stays registered — the
	// pod reflector resolves a pod's Deployment owner through it at projection time.
	//
	// configmaps and secrets are owned-reflector ingest kinds too: the shared factory no
	// longer caches them as typed objects. The helm consumers that still need the typed
	// release object read the dedicated label-filtered helm-storage source (below)
	// instead of a full configmaps/secrets informer.
	//
	// services and endpointslices are owned-reflector ingest kinds too: the shared factory
	// no longer caches them. namespace-network reads the Service OWN-rows + EndpointSlice
	// rows (and the Service↔EndpointSlice endpoint-count join) from the ingest reflectors,
	// and the catalog/object-map/notify consumers read the ingest projections instead.
	//
	// namespaces is a DOCUMENTED NO-CUT (kept on the typed informer), for three reasons:
	//   1. No value. A cluster has a handful of small namespace objects, so the typed
	//      cache is a few KB — cutting it reclaims near-nothing while adding a bespoke
	//      reflector to maintain.
	//   2. No Stream descriptor. resources/namespaces/descriptor.go sets no Stream facet
	//      (the namespaces table is the bespoke NamespaceSummary, snapshot/namespaces.go),
	//      so the generic IngestOwned flip cannot serve it: an ingest projection only
	//      keeps the descriptor's StreamRow output, and there is none. Cutting would
	//      require a hand-written bespoke reflector + full projector (like Pod/Node).
	//   3. Full typed object needed. The namespace domain reads the whole *corev1.Namespace
	//      (snapshot/namespaces.go:128-129 pass ns to BuildResourceModel/BuildFacts, and
	//      :144 reads its ResourceVersion) — the cut path drops the typed object, so the
	//      bespoke projector would have to reproduce the full model at intake. The object
	//      catalog already derives its namespace listing from catalogued objects, not this
	//      informer (objectcatalog/catalog_index.go), so the source-of-truth listing does
	//      not depend on a cut here either way. Detail is a live client Get
	//      (resources/namespaces/namespaces.go:41), independent of this informer.
	result.registerClusterInformer("", "namespaces", func() cache.SharedIndexInformer {
		return kubeFactory.Core().V1().Namespaces().Informer()
	})
	// deployments, statefulsets, daemonsets, jobs, and cronjobs are owned-reflector ingest
	// kinds (IngestOwned), projected at intake by the IngestManager's bespoke workload
	// reflectors; the shared factory no longer caches them as typed objects. Their consumers
	// (the workloads domain, cluster-overview counts, namespace workload tracker, object
	// catalog, object map, response-cache, resource-stream notify) read the ingest
	// projections instead. ReplicaSet stays registered — the pod projector resolves a pod's
	// Deployment owner through it at projection time, and the pod stream re-broadcasts pods
	// on RS changes.
	result.registerInformer("apps", "replicasets", kubeFactory.Apps().V1().ReplicaSets().Informer())
	// roles, rolebindings, serviceaccounts, clusterroles, clusterrolebindings,
	// persistentvolumes, persistentvolumeclaims, storageclasses, ingressclasses, the
	// admission webhook kinds, and ingresses + networkpolicies are owned-reflector ingest
	// kinds (IngestOwned), projected at intake by the IngestManager; the shared factory no
	// longer caches them as typed objects. Their consumers (the rbac/storage/config/network
	// maintained stores, catalog, object map, response-cache) read the ingest projections
	// instead.
	result.registerInformer("autoscaling", "horizontalpodautoscalers", kubeFactory.Autoscaling().V1().HorizontalPodAutoscalers().Informer())
	result.registerInformer("", "events", kubeFactory.Core().V1().Events().Informer())

	if apiextClient != nil {
		result.apiextFactory = apiextinformers.NewSharedInformerFactoryWithOptions(apiextClient, resync, apiextinformers.WithTransform(StripManagedFields))
		result.registerClusterInformer("apiextensions.k8s.io", "customresourcedefinitions", func() cache.SharedIndexInformer {
			return result.apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer()
		})
	}

	result.processPendingClusterInformers()

	// Stand up the helm-storage source (label-filtered owner=helm Secrets+ConfigMaps,
	// full typed objects) for the three helm consumers that still need the typed
	// release object after configmaps/secrets are cut. Its informers join the sync
	// gate; Start runs its factory alongside the shared one.
	result.helmStorage = result.newHelmStorageSource()

	return result
}

// HelmStorage returns the label-filtered helm-storage source backing the three
// helm consumers (namespace-helm lister, resource-stream helm-refresh signal,
// response-cache helm eviction). It is non-nil once New finishes; its accessors
// return nil informers/listers for a kind the identity cannot list/watch.
func (f *Factory) HelmStorage() *HelmStorageSource {
	if f == nil {
		return nil
	}
	return f.helmStorage
}

const gatewayGroup = "gateway.networking.k8s.io"

// WithGatewayFactory registers Gateway API informers that are available on the cluster.
// It must be called before Start so the Gateway caches participate in initial sync.
//
// The eight Gateway-API kinds (gatewayclasses, gateways, httproutes, grpcroutes,
// tlsroutes, listenersets, referencegrants, backendtlspolicies) are a DOCUMENTED
// NO-CUT — kept on this Gateway-API informer factory rather than cut to the
// owned-reflector ingest path. A cut is mechanically feasible: each kind has a Stream
// descriptor, ingest's restClientFor already maps the gateway group to the Gateway
// client (refresh/ingest/manager.go) and exampleObjectFor falls back to the Gateway
// scheme, so the generic IngestOwned flip would feed the table (querypage_typed
// feedMaintainedFromIngest), the catalog (objectcatalog collectViaIngest runs before
// the gateway-informer source), and the notify path. It is NOT worthwhile:
//  1. No value. These objects are few and conditional — the whole factory only exists
//     when Gateway-API is installed (the AnyPresent guard below). The typed cache is a
//     handful of small objects, so a cut reclaims near-nothing.
//  2. The typed objects are not actually eliminated by a cut. The object map collects
//     every Gateway-API kind through its OWN independent live-LIST path
//     (snapshot/object_map.go collectGatewayTyped over objectMapGatewayCollectors),
//     which ignores the IngestOwned facet entirely — gateway kinds carry a
//     GatewayCollector, not a Collector, so collectTyped's ingest-cut branch never
//     touches them. Each object-map build therefore still materialises the full typed
//     Gateway objects regardless of a cut, so the cut would not remove that footprint;
//     it would only add a second copy of the list-decode path in an ingest reflector.
//
// Cutting would add a bespoke-projector reflector and a parallel data path for no
// memory win, so these kinds stay on the typed informer.
func (f *Factory) WithGatewayFactory(factory gatewayinformers.SharedInformerFactory, presence common.GatewayAPIPresence) *Factory {
	if f == nil || factory == nil || presence == nil || !presence.AnyPresent() {
		return f
	}
	f.gatewayFactory = factory
	gateway := factory.Gateway().V1()
	if presence.Has("GatewayClass") {
		f.registerInformer(gatewayGroup, "gatewayclasses", gateway.GatewayClasses().Informer())
	}
	if presence.Has(gatewaypkg.Identity.Kind) {
		f.registerInformer(gatewayGroup, "gateways", gateway.Gateways().Informer())
	}
	if presence.Has(httproutepkg.Identity.Kind) {
		f.registerInformer(gatewayGroup, "httproutes", gateway.HTTPRoutes().Informer())
	}
	if presence.Has(grpcroutepkg.Identity.Kind) {
		f.registerInformer(gatewayGroup, "grpcroutes", gateway.GRPCRoutes().Informer())
	}
	if presence.Has(tlsroutepkg.Identity.Kind) {
		f.registerInformer(gatewayGroup, "tlsroutes", gateway.TLSRoutes().Informer())
	}
	if presence.Has("ListenerSet") {
		f.registerInformer(gatewayGroup, "listenersets", gateway.ListenerSets().Informer())
	}
	if presence.Has("ReferenceGrant") {
		f.registerInformer(gatewayGroup, "referencegrants", gateway.ReferenceGrants().Informer())
	}
	if presence.Has("BackendTLSPolicy") {
		f.registerInformer(gatewayGroup, "backendtlspolicies", gateway.BackendTLSPolicies().Informer())
	}
	return f
}

// Start initialises informers for core resources and waits for their caches to sync.
func (f *Factory) Start(ctx context.Context) error {
	var startErr error
	f.once.Do(func() {
		f.startedAtMu.Lock()
		f.startedAt = time.Now()
		f.startedAtMu.Unlock()
		go f.factory.Start(ctx.Done())
		if f.apiextFactory != nil {
			go f.apiextFactory.Start(ctx.Done())
		}
		if f.gatewayFactory != nil {
			go f.gatewayFactory.Start(ctx.Done())
		}
		if f.helmStorage != nil && f.helmStorage.factory != nil {
			go f.helmStorage.factory.Start(ctx.Done())
		}

		synced := f.waitForCachesToSettle(ctx)
		f.syncedMu.Lock()
		f.synced = synced
		f.syncedMu.Unlock()
		if !synced {
			startErr = context.Canceled
		}
	})
	return startErr
}

// waitForCachesToSettle blocks until every registered informer has either
// synced or terminally failed, returning false only when ctx ends first.
// Waiting on a watch that can never complete would otherwise keep the
// factory unsynced forever and block cluster readiness (issue #225).
func (f *Factory) waitForCachesToSettle(ctx context.Context) bool {
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()
	for {
		if f.cachesSettled() {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
		}
	}
}

func (f *Factory) cachesSettled() bool {
	f.syncStatesMu.Lock()
	states := make([]*informerSyncState, len(f.syncStates))
	copy(states, f.syncStates)
	f.syncStatesMu.Unlock()
	for _, state := range states {
		if !f.stateSettled(state) {
			return false
		}
	}
	return true
}

// stateSettled reports whether one informer has stopped gating readiness: it has
// synced, terminally failed, or been marked degraded. An informer that has done
// none of these but has exceeded the sync deadline is flipped to degraded here
// (logged once) so a single hung GVR — for example a WatchList stream whose
// terminal bookmark was stripped — degrades rather than wedging the whole
// cluster's readiness.
func (f *Factory) stateSettled(state *informerSyncState) bool {
	if state.terminal.Load() || state.degraded.Load() {
		return true
	}
	if state.hasSynced() {
		return true
	}
	if f.syncDeadlineExceeded() && state.degraded.CompareAndSwap(false, true) {
		klog.Warningf("informer for %s did not sync within the deadline — marking degraded and excluding from readiness (LIST+WATCH retries continue in the background)", state.key)
		return true
	}
	return false
}

// syncDeadlineExceeded reports whether the per-informer sync deadline has passed
// since Start began. It is false before Start (zero startedAt) or when no
// deadline is configured, so the deadline never fires in those cases.
func (f *Factory) syncDeadlineExceeded() bool {
	if f.syncDeadline <= 0 {
		return false
	}
	f.startedAtMu.RLock()
	startedAt := f.startedAt
	f.startedAtMu.RUnlock()
	if startedAt.IsZero() {
		return false
	}
	return time.Since(startedAt) > f.syncDeadline
}

// isTerminalWatchError reports whether a reflector failure can never succeed:
// the server does not serve the resource (for example a Gateway API kind
// watched at a version the cluster does not have) or the identity is not
// allowed to watch it. Transient failures — network errors, throttling,
// expired auth — must keep blocking the sync gate, so anything else is false.
func isTerminalWatchError(err error) bool {
	return apierrors.IsNotFound(err) || apierrors.IsForbidden(err)
}

// SharedInformerFactory exposes the underlying factory once started.
func (f *Factory) SharedInformerFactory() informers.SharedInformerFactory {
	return f.factory
}

// APIExtensionsInformerFactory exposes the apiextensions informer factory when available.
func (f *Factory) APIExtensionsInformerFactory() apiextinformers.SharedInformerFactory {
	return f.apiextFactory
}

// GatewayInformerFactory exposes the Gateway API informer factory when available.
func (f *Factory) GatewayInformerFactory() gatewayinformers.SharedInformerFactory {
	if f == nil {
		return nil
	}
	return f.gatewayFactory
}

// HasSynced reports cache sync status.
func (f *Factory) HasSynced(ctx context.Context) bool {
	f.syncedMu.RLock()
	defer f.syncedMu.RUnlock()
	return f.synced
}

// ResourcesSettled reports whether every informer backing the supplied
// canonical resource keys (permissions.ResourceKey format, e.g. "core/pods")
// has either synced or terminally failed. A key with no registered informer
// is settled — the informer was skipped (insufficient permissions, API not
// present) so there is nothing to wait for. A shut-down factory reports
// false, mirroring HasSynced.
func (f *Factory) ResourcesSettled(keys []string) bool {
	if f == nil {
		return false
	}
	f.syncStatesMu.Lock()
	shutdown := f.shutdown
	states := make([]*informerSyncState, len(f.syncStates))
	copy(states, f.syncStates)
	f.syncStatesMu.Unlock()
	if shutdown {
		return false
	}
	if len(keys) == 0 {
		return true
	}
	wanted := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		wanted[key] = struct{}{}
	}
	for _, state := range states {
		if _, ok := wanted[state.key]; !ok {
			continue
		}
		if !f.stateSettled(state) {
			return false
		}
	}
	return true
}

// Shutdown clears factory references to allow garbage collection.
// The informers themselves stop via context cancellation, but clearing
// references ensures memory is reclaimed during transport rebuilds.
func (f *Factory) Shutdown() error {
	// Ensure any in-progress Start has completed before clearing fields.
	// The context should already be cancelled by the caller, so the settle
	// loop inside Start will return quickly.
	f.once.Do(func() {})

	f.syncedMu.Lock()
	f.synced = false
	f.syncedMu.Unlock()

	f.syncStatesMu.Lock()
	f.syncStates = nil
	f.shutdown = true
	f.syncStatesMu.Unlock()

	f.permissionMu.Lock()
	f.permissionAllowed = nil
	f.permissionMu.Unlock()

	// Clear factory references to allow GC
	f.factory = nil
	f.apiextFactory = nil
	f.gatewayFactory = nil
	f.helmStorage = nil
	f.pendingClusterInformers = nil

	return nil
}

func (f *Factory) registerInformer(group, resource string, inf cache.SharedIndexInformer) {
	if inf == nil {
		return
	}
	state := &informerSyncState{key: permissions.ResourceKey(group, resource), hasSynced: inf.HasSynced}
	err := inf.SetWatchErrorHandlerWithContext(func(ctx context.Context, r *cache.Reflector, watchErr error) {
		cache.DefaultWatchErrorHandler(ctx, r, watchErr)
		if isTerminalWatchError(watchErr) && state.terminal.CompareAndSwap(false, true) {
			klog.V(2).Infof("informer excluded from initial cache sync; its watch can never complete: %v", watchErr)
		}
	})
	if err != nil {
		// Handlers can only be set before the informer starts; a started
		// informer keeps the default handler and must sync as before.
		klog.V(2).Infof("informer watch error handler not installed: %v", err)
	}
	f.syncStatesMu.Lock()
	f.syncStates = append(f.syncStates, state)
	f.syncStatesMu.Unlock()
}

type informerFactoryFunc func() cache.SharedIndexInformer

type clusterInformerRegistration struct {
	group    string
	resource string
	factory  informerFactoryFunc
}

type PermissionRequest struct {
	Group    string
	Resource string
	Verb     string
}

func (f *Factory) registerClusterInformer(group, resource string, factory informerFactoryFunc) {
	if f.kubeClient == nil || factory == nil {
		return
	}
	f.pendingClusterInformers = append(f.pendingClusterInformers, clusterInformerRegistration{
		group:    group,
		resource: resource,
		factory:  factory,
	})
}

func (f *Factory) processPendingClusterInformers() {
	if len(f.pendingClusterInformers) == 0 {
		return
	}

	requestsMap := make(map[string]PermissionRequest, len(f.pendingClusterInformers)*2)
	for _, pending := range f.pendingClusterInformers {
		if pending.group == "" && pending.resource == "" {
			continue
		}
		keyList := fmt.Sprintf("list:%s/%s", pending.group, pending.resource)
		requestsMap[keyList] = PermissionRequest{Group: pending.group, Resource: pending.resource, Verb: "list"}
		keyWatch := fmt.Sprintf("watch:%s/%s", pending.group, pending.resource)
		requestsMap[keyWatch] = PermissionRequest{Group: pending.group, Resource: pending.resource, Verb: "watch"}
	}

	if len(requestsMap) > 0 {
		requests := make([]PermissionRequest, 0, len(requestsMap))
		for _, req := range requestsMap {
			requests = append(requests, req)
		}
		ctx, cancel := context.WithTimeout(context.Background(), config.PermissionPrimeTimeout)
		_ = f.PrimePermissions(ctx, requests)
		cancel()
	}

	for _, pending := range f.pendingClusterInformers {
		listAllowed, listErr := f.CanListResource(pending.group, pending.resource)
		watchAllowed, watchErr := f.CanWatchResource(pending.group, pending.resource)
		if listErr != nil || watchErr != nil {
			klog.V(2).Infof("Skipping informer for %s/%s due to access check error: %v %v", pending.group, pending.resource, listErr, watchErr)
			continue
		}
		if !listAllowed || !watchAllowed {
			klog.V(2).Infof("Skipping informer for %s/%s due to insufficient permissions", pending.group, pending.resource)
			continue
		}
		f.registerInformer(pending.group, pending.resource, pending.factory())
	}

	f.pendingClusterInformers = nil
}

func (f *Factory) checkResourceVerb(group, resource, verb string) (bool, error) {
	if f.runtimePermissions == nil {
		return false, fmt.Errorf("permission checker not configured")
	}

	key := fmt.Sprintf("%s/%s/%s", group, resource, verb)
	decision, err := f.runtimePermissions.Can(context.Background(), group, resource, verb)
	if err != nil {
		return false, err
	}
	if decision.Allowed {
		f.trackAllowedPermission(key)
	}
	return decision.Allowed, nil
}

// trackAllowedPermission records that a permission key has been granted at least once.
func (f *Factory) trackAllowedPermission(key string) {
	if f == nil {
		return
	}
	f.permissionMu.Lock()
	if f.permissionAllowed != nil {
		f.permissionAllowed[key] = struct{}{}
	}
	f.permissionMu.Unlock()
}

func (f *Factory) PrimePermissions(ctx context.Context, requests []PermissionRequest) error {
	if len(requests) == 0 {
		return nil
	}
	unique := make(map[string]PermissionRequest, len(requests))
	for _, req := range requests {
		key := fmt.Sprintf("%s/%s/%s", req.Group, req.Resource, req.Verb)
		unique[key] = req
	}

	g, _ := errgroup.WithContext(ctx)
	g.SetLimit(16)
	for _, req := range unique {
		req := req
		g.Go(func() error {
			_, err := f.checkResourceVerb(req.Group, req.Resource, req.Verb)
			return err
		})
	}
	return g.Wait()
}

// PermissionAllowedSnapshot returns keys that have been allowed at least once.
func (f *Factory) PermissionAllowedSnapshot() []string {
	if f == nil {
		return nil
	}
	f.permissionMu.RLock()
	defer f.permissionMu.RUnlock()
	if len(f.permissionAllowed) == 0 {
		return nil
	}
	keys := make([]string, 0, len(f.permissionAllowed))
	for key := range f.permissionAllowed {
		keys = append(keys, key)
	}
	return keys
}
