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
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
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
	recoveryMu         sync.Mutex
	fullSyncRequested  bool
	coalescedDropCount int
	lastOverflowWarn   time.Time
}

type watchBatch struct {
	events       []watchEvent
	timer        *time.Timer
	timerChannel <-chan time.Time
}

func newWatchNotifier(svc *Service) *watchNotifier {
	return &watchNotifier{
		service: svc,
		pending: make(chan watchEvent, config.ObjectCatalogWatchPendingBufferSize),
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

	// sync() parallel goroutines write to the aliased s.items/newItems map
	// without holding s.mu. Defer to a full resync to avoid a concurrent-write race.
	if s.syncInProgress.Load() {
		n.requestFullSync(len(events), false)
		return
	}

	changed := false

	s.mu.Lock()
	for _, evt := range events {
		desc, ok := s.catalogIndex.resource(evt.gvr)
		if !ok {
			continue
		}
		switch evt.eventType {
		case watchEventAdd, watchEventUpdate:
			if evt.obj == nil {
				continue
			}
			s.catalogIndex.setItem(evt.key, s.buildSummary(desc, evt.obj), s.now())
			changed = true
		case watchEventDelete:
			if s.catalogIndex.deleteItem(evt.key) {
				changed = true
			}
		}
	}
	if !changed {
		s.mu.Unlock()
		return
	}
	itemsCopy := cloneSummaryMap(s.items)
	s.mu.Unlock()

	// Descriptors() acquires s.mu.RLock — must call after Unlock.
	descriptors := s.Descriptors()
	// rebuildCacheFromItems calls publishStreamingState which acquires s.mu.Lock.
	s.rebuildCacheFromItems(itemsCopy, descriptors)
	s.broadcastStreaming(true)
}

// run collects events and flushes in debounced batches.
func (n *watchNotifier) run(ctx context.Context) {
	batch := watchBatch{}
	for {
		select {
		case <-ctx.Done():
			n.finishWatchBatch(ctx, &batch, false)
			return
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
	if b.timer == nil {
		b.timer = time.NewTimer(config.ObjectCatalogWatchDebounceInterval)
		b.timerChannel = b.timer.C
	}
	return len(b.events) >= config.ObjectCatalogWatchPendingBufferSize
}

func (n *watchNotifier) finishWatchBatch(ctx context.Context, batch *watchBatch, runRecovery bool) {
	if len(batch.events) > 0 {
		n.flush(batch.events)
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
	svc.registerIngestCatalogSinks()
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
		generic.Informer().AddEventHandler(makeHandler(gr, notifier, svc))
	}
	if apiextFactory != nil {
		crdInformer := apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer()
		gr := schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}
		// Wrap the CRD handler so a CRD add/delete also marks discovery stale: the next
		// discover invalidates the disk-cached discovery document, so a newly-created CRD's
		// kind is discovered promptly rather than waiting out the cache TTL.
		crdInformer.AddEventHandler(svc.crdWatchHandler(makeHandler(gr, notifier, svc)))
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
func (s *Service) crdWatchHandler(base cache.ResourceEventHandlerFuncs) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			s.markDiscoveryStale()
			if base.AddFunc != nil {
				base.AddFunc(obj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			s.markDiscoveryStale()
			if base.UpdateFunc != nil {
				base.UpdateFunc(oldObj, newObj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			s.markDiscoveryStale()
			if base.DeleteFunc != nil {
				base.DeleteFunc(obj)
			}
		},
	}
}

// registerIngestCatalogSinks registers a Catalog-half sink with the ingest manager
// for every ingest-owned (cut) kind, so the live catalog index stays current between
// full collects without reading the shared informer. It is a no-op when no ingest
// source is configured (the uncut configuration).
func (s *Service) registerIngestCatalogSinks() {
	source := s.deps.IngestSource
	if source == nil {
		return
	}
	// Each AddCatalogSink synchronously replays the store's current rows through the
	// sink, and the incremental apply normally ends in a FULL published-cache rebuild
	// — one per cut kind (27 at last count), back-to-back, right in the startup
	// window. Suspend the per-apply rebuild for the loop and publish once at the end;
	// every replay still mutates the index (s.items) under s.mu, so the single
	// rebuild sees all of them.
	s.suspendCacheRebuilds.Store(true)
	for gvr := range catalogIngestOwnedGVRs {
		source.AddCatalogSink(gvr, ingestCatalogSink{service: s, gvr: gvr})
	}
	s.suspendCacheRebuilds.Store(false)

	s.mu.Lock()
	itemsCopy := cloneSummaryMap(s.items)
	s.mu.Unlock()
	// Same publish sequence the appliers use; rebuildCacheFromItems takes s.mu itself,
	// so it must be called without the lock held.
	s.rebuildCacheFromItems(itemsCopy, s.Descriptors())
	s.broadcastStreaming(true)
}

func (s *Service) resolveGRToDescriptor(gr schema.GroupResource) (string, *resourceDescriptor) {
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
