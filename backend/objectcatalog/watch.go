/*
 * backend/objectcatalog/watch.go
 *
 * Informer-driven incremental catalog updates.
 */

package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

type watchEventType int

const (
	watchEventAdd watchEventType = iota
	watchEventUpdate
	watchEventDelete
)

type watchEvent struct {
	eventType watchEventType
	gvr       string
	key       string
	obj       metav1.Object
}

// watchInformerGroupResources is the set of built-in resources the catalog watches
// for incremental updates — the same shared-informer-backed kinds it collects, so
// it derives from the single registry. registerWatchHandlers attaches a handler to
// each via ForResource; no per-kind informer is wired here.
var watchInformerGroupResources = catalogGroupResources(kindspec.CatalogShared)

type watchNotifier struct {
	service            *Service
	pending            chan watchEvent
	resyncRequested    chan struct{}
	recoveryMu         sync.Mutex
	fullSyncRequested  bool
	coalescedDropCount int
	lastOverflowWarn   time.Time
	registrations      []catalogWatchRegistration
	detachIngest       func()
}

type catalogWatchRegistration struct {
	informer cache.SharedIndexInformer
	handler  cache.ResourceEventHandlerRegistration
}

func (n *watchNotifier) addHandler(informer cache.SharedIndexInformer, handler cache.ResourceEventHandler) {
	registration, err := informer.AddEventHandler(handler)
	if err == nil {
		n.registrations = append(n.registrations, catalogWatchRegistration{informer, registration})
	}
}

func (n *watchNotifier) removeHandlers() {
	if n.detachIngest != nil {
		n.detachIngest()
		n.detachIngest = nil
	}
	for _, registration := range n.registrations {
		_ = registration.informer.RemoveEventHandler(registration.handler)
	}
	n.registrations = nil
}

type watchBatch struct {
	events       []watchEvent
	timer        *time.Timer
	timerChannel <-chan time.Time
}

func newWatchNotifier(svc *Service) *watchNotifier {
	return &watchNotifier{
		service:         svc,
		pending:         make(chan watchEvent, config.ObjectCatalogWatchPendingBufferSize),
		resyncRequested: make(chan struct{}, 1),
	}
}

// flush applies a batch of watch events to the catalog.
func (n *watchNotifier) flush(events []watchEvent) {
	if len(events) == 0 {
		return
	}
	s := n.service
	if !s.syncMu.TryLock() {
		n.requestFullSync(len(events), false)
		return
	}
	defer s.syncMu.Unlock()

	// A baseline in progress must incorporate subsequent watch changes before
	// they are treated as authoritative. Request another pass if it is active.
	if s.syncInProgress.Load() {
		n.requestFullSync(len(events), false)
		return
	}

	s.mu.Lock()
	changes := make([]catalogChange, 0, len(events))
	for _, evt := range events {
		if change, changed := s.applyWatchEvent(evt); changed {
			changes = append(changes, change)
		}
	}
	if len(changes) == 0 {
		s.mu.Unlock()
		return
	}
	published := s.publishCatalogChangesLocked(changes)
	s.mu.Unlock()
	if published {
		s.broadcastStreaming(true)
	}
}

// applyWatchEvent runs under the catalog publication lock.
func (s *Service) applyWatchEvent(event watchEvent) (catalogChange, bool) {
	desc, ok := s.catalogIndex.resource(event.gvr)
	if !ok {
		return catalogChange{}, false
	}
	switch event.eventType {
	case watchEventAdd, watchEventUpdate:
		if event.obj == nil {
			return catalogChange{}, false
		}
		return s.catalogIndex.setItem(event.key, s.buildSummary(desc, event.obj), s.now()), true
	case watchEventDelete:
		return s.catalogIndex.deleteItem(event.key)
	default:
		return catalogChange{}, false
	}
}

// run collects events and flushes in debounced batches.
func (n *watchNotifier) run(ctx context.Context) {
	batch := watchBatch{}
	for {
		select {
		case <-ctx.Done():
			n.finishWatchBatch(ctx, &batch, false)
			return
		case <-n.resyncRequested:
			batch.startTimer()
		case evt, ok := <-n.pending:
			if !ok {
				n.finishWatchBatch(ctx, &batch, false)
				return
			}
			if batch.add(evt) {
				n.finishWatchBatch(ctx, &batch, true)
			}
		case <-batch.timerChannel:
			n.finishWatchBatch(ctx, &batch, true)
		}
	}
}

func (b *watchBatch) add(event watchEvent) bool {
	b.events = append(b.events, event)
	b.startTimer()
	return len(b.events) >= config.ObjectCatalogWatchPendingBufferSize
}

func (b *watchBatch) startTimer() {
	if b.timer == nil {
		b.timer = time.NewTimer(config.ObjectCatalogWatchDebounceInterval)
		b.timerChannel = b.timer.C
	}
}

func (n *watchNotifier) finishWatchBatch(ctx context.Context, batch *watchBatch, runRecovery bool) {
	events := batch.events
	if len(events) > 0 {
		n.flush(events)
	}
	if runRecovery {
		n.runRecoverySync(ctx)
	}
	batch.events = nil
	batch.stopTimer()
}

func (b *watchBatch) stopTimer() {
	if b.timer != nil && !b.timer.Stop() {
		select {
		case <-b.timer.C:
		default:
		}
	}
	b.timer = nil
	b.timerChannel = nil
}

// send enqueues a watch event. If the bounded queue is saturated, it drops the
// individual payload but schedules a full sync so the catalog converges.
func (n *watchNotifier) send(evt watchEvent) {
	select {
	case n.pending <- evt:
	default:
		n.requestFullSync(1, true)
	}
}

func (n *watchNotifier) requestFullSync(coalescedDrops int, warn bool) {
	var warnMsg string
	n.recoveryMu.Lock()
	n.fullSyncRequested = true
	n.coalescedDropCount += coalescedDrops
	if warn && n.service.deps.Logger != nil {
		now := n.service.now()
		if n.lastOverflowWarn.IsZero() || now.Sub(n.lastOverflowWarn) >= config.ObjectCatalogWatchOverflowWarnInterval {
			n.lastOverflowWarn = now
			warnMsg = fmt.Sprintf("catalog watch notifier buffer full; coalescing events and scheduling full catalog resync (coalesced=%d)", n.coalescedDropCount)
		}
	}
	n.recoveryMu.Unlock()
	select {
	case n.resyncRequested <- struct{}{}:
	default:
	}

	if warnMsg != "" {
		n.service.logWarn(warnMsg)
	}
}

func (n *watchNotifier) takeFullSyncRequest() (int, bool) {
	n.recoveryMu.Lock()
	defer n.recoveryMu.Unlock()
	if !n.fullSyncRequested {
		return 0, false
	}
	count := n.coalescedDropCount
	n.fullSyncRequested = false
	n.coalescedDropCount = 0
	return count, true
}

func (n *watchNotifier) runRecoverySync(ctx context.Context) {
	coalescedDrops, requested := n.takeFullSyncRequest()
	if !requested {
		return
	}
	if err := n.service.sync(ctx); err != nil && !errors.Is(err, context.Canceled) {
		n.service.logWarn(fmt.Sprintf("catalog watch recovery sync failed after coalescing %d event(s): %v", coalescedDrops, err))
	}
}

// makeHandler builds an informer event handler for the given GroupResource.
func makeHandler(gr schema.GroupResource, notifier *watchNotifier, svc *Service) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) { sendWatchObject(gr, notifier, svc, watchEventAdd, obj) },
		UpdateFunc: func(oldObj, newObj interface{}) {
			if !sameObjectResourceVersion(oldObj, newObj) {
				sendWatchObject(gr, notifier, svc, watchEventUpdate, newObj)
			}
		},
		DeleteFunc: func(obj interface{}) { sendWatchObject(gr, notifier, svc, watchEventDelete, unwrapDeletedObject(obj)) },
	}
}

func crdChangesDiscovery(oldObj, newObj interface{}) bool {
	old, oldOK := oldObj.(*apiextensionsv1.CustomResourceDefinition)
	next, nextOK := newObj.(*apiextensionsv1.CustomResourceDefinition)
	if !oldOK || !nextOK {
		return true
	}
	return old.UID != next.UID || old.Spec.Group != next.Spec.Group || old.Spec.Scope != next.Spec.Scope ||
		!reflect.DeepEqual(old.Spec.Names, next.Spec.Names) ||
		!reflect.DeepEqual(old.Status.AcceptedNames, next.Status.AcceptedNames) ||
		!slices.Equal(crdServedVersions(old), crdServedVersions(next)) ||
		crdEstablished(old) != crdEstablished(next)
}

func crdServedVersions(crd *apiextensionsv1.CustomResourceDefinition) []string {
	versions := make([]string, 0, len(crd.Spec.Versions))
	for _, version := range crd.Spec.Versions {
		if version.Served {
			versions = append(versions, version.Name)
		}
	}
	slices.Sort(versions)
	return versions
}

// Establishment changes API availability; ordinary status reason/timestamp
// updates do not change discovery and must not recollect every resource kind.
func crdEstablished(crd *apiextensionsv1.CustomResourceDefinition) bool {
	for _, condition := range crd.Status.Conditions {
		if condition.Type == apiextensionsv1.Established {
			return condition.Status == apiextensionsv1.ConditionTrue
		}
	}
	return false
}

func sameObjectResourceVersion(oldObj, newObj interface{}) bool {
	oldMeta, oldOK := toMetaObject(oldObj)
	newMeta, newOK := toMetaObject(newObj)
	return oldOK && newOK && oldMeta.GetResourceVersion() == newMeta.GetResourceVersion()
}

func unwrapDeletedObject(obj interface{}) interface{} {
	if deleted, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return deleted.Obj
	}
	return obj
}

func sendWatchObject(gr schema.GroupResource, notifier *watchNotifier, svc *Service, eventType watchEventType, obj interface{}) {
	metaObj, ok := toMetaObject(obj)
	if !ok {
		return
	}
	gvr, desc := svc.resolveGRToDescriptor(gr)
	if desc == nil {
		return
	}
	key := catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName())
	if eventType == watchEventDelete {
		metaObj = nil
	}
	notifier.send(watchEvent{
		eventType: eventType,
		gvr:       gvr,
		key:       key,
		obj:       metaObj,
	})
}

// registerWatchHandlers attaches event handlers to shared informers, and registers
// an ingest Catalog-half sink for each ingest-owned (cut) kind instead — those kinds
// are no longer cached by the shared factory, so their incremental catalog updates
// flow from the ingest reflector rather than a factory informer handler.
func registerWatchHandlers(
	factory informers.SharedInformerFactory,
	apiextFactory apiextinformers.SharedInformerFactory,
	notifier *watchNotifier,
	svc *Service,
) {
	notifier.detachIngest = svc.registerIngestCatalogSinks()
	registerGatewayWatchHandlers(notifier, svc)
	if factory == nil {
		return
	}
	for gr, gvr := range watchInformerGroupResources {
		if isIngestOwned(gr) {
			// Cut kind: its incremental updates come from the ingest sink registered
			// above, not from a shared-informer handler (the factory no longer caches it).
			continue
		}
		generic, err := factory.ForResource(gvr)
		if err != nil {
			continue
		}
		notifier.addHandler(generic.Informer(), makeHandler(gr, notifier, svc))
	}
	if apiextFactory != nil {
		crdInformer := apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer()
		gr := schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}
		// Wrap the CRD handler so a CRD add/delete also marks discovery stale: the next
		// discover invalidates the disk-cached discovery document, so a newly-created CRD's
		// kind is discovered promptly rather than waiting out the cache TTL.
		notifier.addHandler(crdInformer, notifier.crdWatchHandler(makeHandler(gr, notifier, svc)))
	}
}

// Collection and change handlers use the same registry and shared factory. This
// attaches listeners to existing informers, without starting another watch.
func registerGatewayWatchHandlers(notifier *watchNotifier, svc *Service) {
	factory := svc.deps.GatewayInformerFactory
	if factory == nil {
		return
	}
	for gr, gvr := range gatewayInformerGroupResources {
		if checker := svc.deps.PermissionChecker; checker != nil && !checker.CanListWatch(gr.Group, gr.Resource) {
			continue
		}
		generic, err := factory.ForResource(gvr)
		if err != nil {
			continue
		}
		notifier.addHandler(generic.Informer(), makeHandler(gr, notifier, svc))
	}
}

// markDiscoveryStale latches that the discovery document changed (a CRD was added or
// removed), so the next discoverResources invalidates the disk-cached discovery before
// re-discovering.
func (s *Service) markDiscoveryStale() {
	s.discoveryStale.Store(true)
}

// crdWatchHandler wraps the CRD informer's catalog handler so a CRD add/update/delete marks
// discovery stale (forcing a cache invalidation on the next discover) before delegating to
// the base handler — keeping newly-created CRDs from being hidden by a cached discovery doc.
func (n *watchNotifier) crdWatchHandler(base cache.ResourceEventHandlerFuncs) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			n.crdDiscoveryChanged(obj, true)
			if base.AddFunc != nil {
				base.AddFunc(obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if crdChangesDiscovery(oldObj, newObj) {
				n.crdDiscoveryChanged(newObj, false)
			}
			if base.UpdateFunc != nil {
				base.UpdateFunc(oldObj, newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			n.crdDiscoveryChanged(obj, false)
			if base.DeleteFunc != nil {
				base.DeleteFunc(obj)
			}
		},
	}
}

func (n *watchNotifier) crdDiscoveryChanged(obj interface{}, added bool) {
	n.service.markDiscoveryStale()
	if crd, ok := obj.(*apiextensionsv1.CustomResourceDefinition); added && ok {
		if !crdEstablished(crd) {
			return
		}
		// An initial handler replay does not need another full catalog collection.
		gr := schema.GroupResource{Group: crd.Spec.Group, Resource: crd.Spec.Names.Plural}
		if _, desc := n.service.resolveGRToDescriptor(gr); desc != nil {
			return
		}
	}
	n.requestFullSync(0, false)
}

// registerIngestCatalogSinks registers a Catalog-half sink with the ingest manager
// for every ingest-owned (cut) kind, so the live catalog index stays current between
// full collects without reading the shared informer. It is a no-op when no ingest
// source is configured (the uncut configuration).
func (s *Service) registerIngestCatalogSinks() func() {
	source := s.deps.IngestSource
	if source == nil {
		return func() {}
	}
	// Registering a sink replays the source under its store lock. Defer publication
	// until every kind is registered, then replace the query baseline once.
	s.suspendPublication.Store(true)
	detach := make([]func(), 0, len(catalogIngestOwnedGVRs))
	for gvr := range catalogIngestOwnedGVRs {
		detach = append(detach, source.SubscribeCatalogSink(gvr, ingestCatalogSink{service: s, gvr: gvr}))
	}
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	s.mu.Lock()
	s.cacheRebuilds.Add(1)
	s.catalogIndex.rebuildCacheFromItems(s.items, s.catalogIndex.descriptors())
	s.replaceFinalizerBlockers(s.items)
	s.suspendPublication.Store(false)
	s.mu.Unlock()
	s.broadcastStreaming(true)
	return func() {
		for _, unsubscribe := range detach {
			unsubscribe()
		}
	}
}

func (s *Service) resolveGRToDescriptor(gr schema.GroupResource) (string, *Descriptor) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.resourceForGroupResource(gr.Group, gr.Resource)
}

func toMetaObject(obj interface{}) (metav1.Object, bool) {
	if obj == nil {
		return nil, false
	}
	metaObj, ok := obj.(metav1.Object)
	return metaObj, ok
}
