/*
 * backend/objectcatalog/ingest_source.go
 *
 * The catalog's side of the owned-reflector ingest cutover. For ingest-owned (cut)
 * kinds the shared informer factory no longer caches the typed object, so the
 * catalog reads those kinds two ways from the ingest manager instead:
 *
 *   - the full collect path reads CatalogRows(gvr) (Summaries projected at intake);
 *   - incremental updates arrive through a Catalog-half ingest Sink that applies the
 *     same per-object summary set/delete the shared-informer watch handler did.
 *
 * SummaryProjector is registered with the ingest manager (before it starts) so the
 * Catalog half of each cut kind's bundle is the exact Summary the live collect path
 * would build — the projection is the one summaryFromObject the Service uses.
 */

package objectcatalog

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcekind"
)

// The ingest manager is the production IngestSource; this assertion pins the
// interface to it so a signature drift fails to compile here rather than at wiring.
var _ IngestSource = (*ingest.IngestManager)(nil)

// SummaryProjector returns the ingest Catalog-half projector for one cut kind: it
// projects each ingested object into the catalog Summary the live collect path would
// build, using the same summaryFromObject projection. It is registered with the
// ingest manager before Start so every object — including the initial relist —
// carries the catalog half. clusterID stamps the summary's cluster identity
// exactly as the Service's buildSummary does.
func SummaryProjector(clusterID string, identity resourcekind.Identity) func(metav1.Object) interface{} {
	desc := builtinDescriptor(identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespaced)
	return func(obj metav1.Object) interface{} {
		return summaryFromObject(clusterID, desc, obj)
	}
}

// catalogIngestOwnedGVRs is the set of GVRs cut over to the ingest path, derived
// from the single kind registry's IngestOwned facet. The catalog reads these from
// the ingest manager rather than the shared informer; flipping the facet on the next
// domain's kinds adds them here automatically.
var catalogIngestOwnedGVRs = kindregistry.IngestOwnedGVRs()

// isIngestOwned reports whether a GroupResource is served by the ingest path. The
// catalog keys its collect/watch plans by GroupResource, so this resolves the cut
// set's GVRs to their GroupResource for membership.
func isIngestOwned(gr schema.GroupResource) bool {
	for gvr := range catalogIngestOwnedGVRs {
		if gvr.GroupResource() == gr {
			return true
		}
	}
	return false
}

// collectViaIngest serves a cut kind's full collect from the ingest manager's
// CatalogRows (Summaries projected at intake) instead of a shared/dynamic lister.
// It returns handled=false (so the caller falls through to the next source) only
// when the kind is not ingest-owned or no ingest source is configured. For a cut
// kind it ALWAYS handles the collect, so the catalog never falls through to the
// shared factory for a GVR the factory no longer registers. Static cut kinds
// report an incomplete collect until their own ingest store has synced/settled.
// Summaries for a namespaced kind are filtered to the requested namespaces,
// matching the lister path's per-namespace scope.
func (s *Service) collectViaIngest(desc Descriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	source := s.deps.IngestSource
	if source == nil {
		return nil, false, nil
	}
	gvr := desc.GVR()
	_, staticCut := catalogIngestOwnedGVRs[gvr]
	if !staticCut {
		return nil, false, nil
	}
	if !source.HasSyncedFor(gvr) {
		return nil, true, fmt.Errorf("catalog ingest store for %s is not synced", gvr)
	}
	summaries := catalogSummaries(source.CatalogRows(gvr), requestedNamespaceSet(desc, namespaces))
	return emitSummaries(agg, summaries, nil, true)
}

// catalogSummaries keeps only catalog projections in the requested namespace set.
// A nil set includes every namespace; an empty set includes none.
func catalogSummaries(rows []interface{}, allowed map[string]struct{}) []Summary {
	summaries := make([]Summary, 0, len(rows))
	for _, row := range rows {
		summary, ok := row.(Summary)
		if !ok {
			continue
		}
		_, included := allowed[summary.Ref.Namespace]
		if allowed != nil && !included {
			continue
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

// requestedNamespaceSet returns the set of namespaces a namespaced cut kind's
// summaries must match for this request, or nil when every namespace is in scope (a
// cluster-scoped kind, or a namespaced request with no namespace filter — the
// all-namespaces case). It mirrors listTargets' scoping so the ingest collect path
// returns the same set the lister path would.
func requestedNamespaceSet(desc Descriptor, namespaces []string) map[string]struct{} {
	if !desc.Namespaced || len(namespaces) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(namespaces))
	for _, ns := range uniqueNamespaces(namespaces) {
		out[ns] = struct{}{}
	}
	return out
}

// applyIngestCatalogSummary applies one incremental Catalog-half update from the
// ingest sink to the published catalog indexes before broadcasting. It serializes
// against full syncs the same way watchNotifier.flush does.
func (s *Service) applyIngestCatalogSummary(gvr schema.GroupVersionResource, summary Summary, deleted bool) {
	if !s.syncMu.TryLock() {
		s.queueIngestReconciliation(gvr)
		return
	}
	defer s.syncMu.Unlock()
	if s.syncInProgress.Load() {
		return
	}

	desc, ok := s.resolveIngestDescriptor(gvr)
	if !ok {
		return
	}
	s.publishIngestSummary(desc, summary, deleted)
}

// The caller owns syncMu; both static and dynamic updates use this publication boundary.
func (s *Service) publishIngestSummary(desc Descriptor, summary Summary, deleted bool) {
	key := catalogKey(desc, summary.Ref.Namespace, summary.Ref.Name)

	s.mu.Lock()
	var change catalogChange
	changed := true
	if deleted {
		if existing, ok := s.catalogIndex.items[key]; ok && existing.Ref.UID != summary.Ref.UID {
			s.mu.Unlock()
			return
		}
		change, changed = s.catalogIndex.deleteItem(key)
	} else {
		change = s.catalogIndex.setItem(key, summary, s.now())
	}
	if !changed {
		s.mu.Unlock()
		return
	}
	published := s.publishCatalogChangesLocked([]catalogChange{change})
	s.mu.Unlock()
	if published {
		s.broadcastStreaming(true)
	}
}

func (s *Service) replaceIngestCatalogSummaries(gvr schema.GroupVersionResource, rows []Summary) {
	if !s.syncMu.TryLock() {
		s.queueIngestReconciliation(gvr)
		return
	}
	defer s.syncMu.Unlock()
	s.replaceIngestCatalogSummariesLocked(gvr, rows)
}

func (s *Service) replaceIngestCatalogSummariesLocked(gvr schema.GroupVersionResource, rows []Summary) {
	desc, ok := s.resolveIngestDescriptor(gvr)
	if !ok {
		return
	}
	now := s.now()

	s.mu.Lock()
	changes := make([]catalogChange, 0, len(rows))
	for key, existing := range s.catalogIndex.items {
		if !summaryMatchesDescriptor(existing, desc) {
			continue
		}
		change, _ := s.catalogIndex.deleteItem(key)
		changes = append(changes, change)
	}
	for _, summary := range rows {
		key := catalogKey(desc, summary.Ref.Namespace, summary.Ref.Name)
		changes = append(changes, s.catalogIndex.setItem(key, summary, now))
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

func summaryMatchesDescriptor(summary Summary, desc Descriptor) bool {
	return summary.Ref.Group == desc.Group &&
		summary.Ref.Version == desc.Version &&
		summary.Ref.Resource == desc.Resource &&
		summary.Ref.Kind == desc.Kind
}

// resolveIngestDescriptor resolves a cut kind's GVR to its catalog descriptor from
// the index, so an incremental sink update keys its summary the same way the collect
// path does.
func (s *Service) resolveIngestDescriptor(gvr schema.GroupVersionResource) (Descriptor, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, desc := s.catalogIndex.resourceForGroupResource(gvr.Group, gvr.Resource)
	if desc == nil {
		return Descriptor{}, false
	}
	return *desc, true
}

// ingestCatalogSink adapts the catalog's incremental summary apply to an ingest
// Catalog-half Sink. The reflector delivers the already-projected Summary on
// Upsert/Delete (never the source object), so the sink keys off the Summary itself —
// exactly the data the shared-informer watch handler used to derive from the object.
type ingestCatalogSink struct {
	service *Service
	gvr     schema.GroupVersionResource
}

func (s ingestCatalogSink) Upsert(row interface{}) {
	summary, ok := row.(Summary)
	if !ok {
		return
	}
	s.service.applyIngestCatalogSummary(s.gvr, summary, false)
}

func (s ingestCatalogSink) Delete(row interface{}) {
	summary, ok := row.(Summary)
	if !ok {
		return
	}
	s.service.applyIngestCatalogSummary(s.gvr, summary, true)
}

func (s ingestCatalogSink) Replace(rows []interface{}) {
	s.service.replaceIngestCatalogSummaries(s.gvr, catalogSummaries(rows, nil))
}

// Coalesce contention by kind, then reread its authoritative store after the
// callback releases the store lock. Waiting for syncMu inside a sink would
// invert the full-sync -> source-store lock order.
func (s *Service) queueIngestReconciliation(gvr schema.GroupVersionResource) {
	s.ingestPendingMu.Lock()
	defer s.ingestPendingMu.Unlock()
	if s.ingestStopped || s.deps.IngestSource == nil {
		return
	}
	if s.ingestPending == nil {
		s.ingestPending = make(map[schema.GroupVersionResource]struct{})
	}
	s.ingestPending[gvr] = struct{}{}
	if s.ingestDrainDone != nil {
		return
	}
	done := make(chan struct{})
	s.ingestDrainDone = done
	go s.drainIngestReconciliation(done)
}

func (s *Service) drainIngestReconciliation(done chan struct{}) {
	defer close(done)
	for {
		s.ingestPendingMu.Lock()
		if s.ingestStopped || len(s.ingestPending) == 0 {
			s.ingestDrainDone = nil
			s.ingestPendingMu.Unlock()
			return
		}
		var gvr schema.GroupVersionResource
		for candidate := range s.ingestPending {
			gvr = candidate
			break
		}
		delete(s.ingestPending, gvr)
		s.ingestPendingMu.Unlock()

		s.syncMu.Lock()
		s.reconcileCurrentIngestSource(gvr)
		s.syncMu.Unlock()
	}
}

func (s *Service) stopIngestReconciliation() {
	s.ingestPendingMu.Lock()
	s.ingestStopped = true
	s.ingestPending = nil
	done := s.ingestDrainDone
	s.ingestPendingMu.Unlock()
	if done != nil {
		<-done
	}
}
