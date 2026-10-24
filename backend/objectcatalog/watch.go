/*
 * backend/objectcatalog/watch.go
 *
 * Incremental catalog updates: ingest sink registration, the CRD discovery
 * hook, and the debounced full-resync loop they request.
 */

package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

type watchNotifier struct {
	service           *Service
	resyncRequested   chan struct{}
	recoveryMu        sync.Mutex
	fullSyncRequested bool
	detachIngest      func()
}

func (n *watchNotifier) removeHandlers() {
	if n.detachIngest != nil {
		n.detachIngest()
		n.detachIngest = nil
	}
}

// resyncDebounce is the open window before a requested full resync runs, so a
// burst of requests is one sync.
type resyncDebounce struct {
	timer        *time.Timer
	timerChannel <-chan time.Time
}

func newWatchNotifier(svc *Service) *watchNotifier {
	return &watchNotifier{
		service:         svc,
		resyncRequested: make(chan struct{}, 1),
	}
}

// run debounces full-resync requests and runs each recovery sync.
func (n *watchNotifier) run(ctx context.Context) {
	debounce := resyncDebounce{}
	for {
		select {
		case <-ctx.Done():
			debounce.stop()
			return
		case <-n.resyncRequested:
			debounce.start()
		case <-debounce.timerChannel:
			debounce.stop()
			n.runRecoverySync(ctx)
		}
	}
}

func (d *resyncDebounce) start() {
	if d.timer == nil {
		d.timer = time.NewTimer(config.ObjectCatalogWatchDebounceInterval)
		d.timerChannel = d.timer.C
	}
}

func (d *resyncDebounce) stop() {
	if d.timer != nil && !d.timer.Stop() {
		select {
		case <-d.timer.C:
		default:
		}
	}
	d.timer = nil
	d.timerChannel = nil
}

// requestFullSync asks the run loop for a full collection; requests within
// the debounce window are one sync.
func (n *watchNotifier) requestFullSync() {
	n.recoveryMu.Lock()
	n.fullSyncRequested = true
	n.recoveryMu.Unlock()
	select {
	case n.resyncRequested <- struct{}{}:
	default:
	}
}

func (n *watchNotifier) takeFullSyncRequest() bool {
	n.recoveryMu.Lock()
	defer n.recoveryMu.Unlock()
	requested := n.fullSyncRequested
	n.fullSyncRequested = false
	return requested
}

func (n *watchNotifier) runRecoverySync(ctx context.Context) {
	if !n.takeFullSyncRequest() {
		return
	}
	if err := n.service.sync(ctx); err != nil && !errors.Is(err, context.Canceled) {
		n.service.logWarn(fmt.Sprintf("catalog recovery sync failed: %v", err))
	}
}

// registerWatchHandlers registers an ingest Catalog-half sink for each
// ingest-owned kind and the CRD discovery hook, so the catalog stays current
// between full collections.
func registerWatchHandlers(notifier *watchNotifier, svc *Service) {
	detachCatalog := svc.registerIngestCatalogSinks()
	detachDiscovery := svc.registerCRDDiscoveryHook(notifier)
	notifier.detachIngest = func() {
		detachDiscovery()
		detachCatalog()
	}
}

// markDiscoveryStale latches that the discovery document changed (a CRD was added or
// removed), so the next discoverResources invalidates the disk-cached discovery before
// re-discovering.
func (s *Service) markDiscoveryStale() {
	s.discoveryStale.Store(true)
}

// registerCRDDiscoveryHook subscribes the discovery-staleness hook to the
// CRD ingest store. It is a no-op without an ingest source.
func (s *Service) registerCRDDiscoveryHook(notifier *watchNotifier) func() {
	source := s.deps.IngestSource
	if source == nil {
		return func() {
			// No ingest source means no hook was registered, so there is nothing to detach.
		}
	}
	return source.SubscribeBundleSink(apiextensions.Identity.GVR(), newCRDDiscoveryHook(notifier))
}

// crdDiscoveryHook marks discovery stale when a CustomResourceDefinition
// changes what API discovery serves, so the next discover invalidates the
// disk-cached discovery document and a new CRD's kind is not hidden behind it.
// Bundle sinks see no previous row, so the hook remembers the last definition
// it saw for each UID. Only the CRD store's write lock calls it, so seen needs
// no lock of its own.
type crdDiscoveryHook struct {
	notifier *watchNotifier
	seen     map[types.UID]apiextensions.Definition
}

var _ ingest.BundleReplacer = (*crdDiscoveryHook)(nil)

func newCRDDiscoveryHook(notifier *watchNotifier) *crdDiscoveryHook {
	return &crdDiscoveryHook{notifier: notifier, seen: make(map[types.UID]apiextensions.Definition)}
}

func (h *crdDiscoveryHook) UpsertBundle(bundle ingest.Bundle) {
	definition, ok := bundle.Aggregate.(apiextensions.Definition)
	if !ok {
		return
	}
	previous, seen := h.seen[definition.UID]
	h.seen[definition.UID] = definition
	switch {
	case !seen:
		h.notifier.crdAdded(definition)
	case previous.ChangesDiscovery(definition):
		h.notifier.crdDiscoveryChanged()
	}
}

func (h *crdDiscoveryHook) DeleteBundle(bundle ingest.Bundle) {
	definition, ok := bundle.Aggregate.(apiextensions.Definition)
	if !ok {
		return
	}
	delete(h.seen, definition.UID)
	h.notifier.crdDiscoveryChanged()
}

// ReplaceBundles diffs a relist's complete set against the last-seen
// definitions: a vanished or changed definition requests one full
// collection, and a new one is handled as an add.
func (h *crdDiscoveryHook) ReplaceBundles(bundles []ingest.Bundle) {
	next := make(map[types.UID]apiextensions.Definition, len(bundles))
	for _, bundle := range bundles {
		if definition, ok := bundle.Aggregate.(apiextensions.Definition); ok {
			next[definition.UID] = definition
		}
	}
	previous := h.seen
	h.seen = next
	for uid, old := range previous {
		if current, kept := next[uid]; !kept || old.ChangesDiscovery(current) {
			h.notifier.crdDiscoveryChanged()
			break
		}
	}
	for uid, definition := range next {
		if _, existed := previous[uid]; !existed {
			h.notifier.crdAdded(definition)
		}
	}
}

// crdAdded marks discovery stale for a new definition. Its API needs a full
// collection only once established, and only when the catalog does not
// already list the resource (an initial replay does not).
func (n *watchNotifier) crdAdded(definition apiextensions.Definition) {
	n.service.markDiscoveryStale()
	if !definition.Established {
		return
	}
	gr := schema.GroupResource{Group: definition.Group, Resource: definition.Names.Plural}
	if _, desc := n.service.resolveGRToDescriptor(gr); desc != nil {
		return
	}
	n.requestFullSync()
}

// crdDiscoveryChanged marks discovery stale and requests a full collection
// for a definition that changed its served API or went away.
func (n *watchNotifier) crdDiscoveryChanged() {
	n.service.markDiscoveryStale()
	n.requestFullSync()
}

// registerIngestCatalogSinks registers a Catalog-half sink with the ingest manager
// for every collected built-in kind, so the live catalog index stays current between
// full collects. It is a no-op when no ingest source is configured (unit tests).
func (s *Service) registerIngestCatalogSinks() func() {
	source := s.deps.IngestSource
	if source == nil {
		return func() {
			// No ingest source means no sinks were registered, so there is nothing to detach.
		}
	}
	// Registering a sink replays the source under its store lock, and the replay
	// queues a partition-aware reconcile of its kind. Defer publication until
	// every kind is registered, reconcile every kind here, then replace the query
	// baseline once. The built-in kinds' queued work is dropped because this pass
	// covers it; queued custom resources stay for the drain worker.
	s.suspendPublication.Store(true)
	detach := make([]func(), 0, len(catalogIngestGVRs))
	for gvr := range catalogIngestGVRs {
		detach = append(detach, source.SubscribeCatalogSink(gvr, ingestCatalogSink{service: s, gvr: gvr}))
	}
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	s.dropPendingIngestReconciliation(catalogIngestGVRs)
	for gvr := range catalogIngestGVRs {
		s.reconcileCurrentIngestSource(gvr)
	}
	s.mu.Lock()
	s.cacheRebuilds.Add(1)
	s.catalogIndex.rebuildCacheFromItems(s.items, s.catalogIndex.descriptors())
	s.replaceAttentionSubsets(s.items)
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
