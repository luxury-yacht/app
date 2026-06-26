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
	"time"

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
// carries the catalog half. clusterID/clusterName stamp the summary's cluster
// identity exactly as the Service's buildSummary does.
func SummaryProjector(clusterID, clusterName string, identity resourcekind.Identity) func(metav1.Object) interface{} {
	desc := builtinDescriptor(identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespaced)
	return func(obj metav1.Object) interface{} {
		return summaryFromObject(clusterID, clusterName, desc, obj)
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
// report an incomplete collect until their own ingest store has synced/settled;
// dynamic cuts still fall through to LIST until their on-demand reflector syncs.
// Summaries for a namespaced kind are filtered to the requested namespaces,
// matching the lister path's per-namespace scope.
func (s *Service) collectViaIngest(index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	source := s.deps.IngestSource
	if source == nil {
		return nil, false, nil
	}
	gvr := desc.GVR
	_, staticCut := catalogIngestOwnedGVRs[gvr]
	dynamicCut := s.isDynamicallyIngested(gvr)
	if !staticCut && !dynamicCut {
		return nil, false, nil
	}
	// A dynamic (on-demand promoted) kind serves from the ingest store only once its
	// reflector's initial relist has landed; until then return handled=false so the caller
	// falls through to LIST (no empty flash), exactly as the former promotion path served
	// from the informer only after HasSynced. Static cut kinds have no fallback informer,
	// so they remain handled but make the sync incomplete until their own store settles.
	if dynamicCut && !staticCut && !source.HasSyncedFor(gvr) {
		return nil, false, nil
	}
	if staticCut && !source.HasSyncedFor(gvr) {
		return nil, true, fmt.Errorf("catalog ingest store for %s is not synced", gvr)
	}
	rows := source.CatalogRows(gvr)
	allowed := requestedNamespaceSet(desc, namespaces)
	summaries := make([]Summary, 0, len(rows))
	for _, row := range rows {
		summary, ok := row.(Summary)
		if !ok {
			continue
		}
		if allowed != nil {
			if _, ok := allowed[summary.Namespace]; !ok {
				continue
			}
		}
		summaries = append(summaries, summary)
	}
	return emitSummaries(index, agg, summaries, nil, true)
}

// requestedNamespaceSet returns the set of namespaces a namespaced cut kind's
// summaries must match for this request, or nil when every namespace is in scope (a
// cluster-scoped kind, or a namespaced request with no namespace filter — the
// all-namespaces case). It mirrors listTargets' scoping so the ingest collect path
// returns the same set the lister path would.
func requestedNamespaceSet(desc resourceDescriptor, namespaces []string) map[string]struct{} {
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
// ingest sink to the live catalog index, set or delete, then rebuilds the published
// cache and broadcasts — the same effect the shared-informer watch handler had for
// this kind. It serializes against full syncs the same way watchNotifier.flush does.
func (s *Service) applyIngestCatalogSummary(gvr schema.GroupVersionResource, summary Summary, deleted bool) {
	if !s.syncMu.TryLock() {
		// A full sync is in progress and will reconcile this kind from CatalogRows;
		// dropping the incremental is safe because the sync reads the same store.
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
	key := catalogKey(desc, summary.Namespace, summary.Name)

	s.mu.Lock()
	changed := false
	if deleted {
		changed = s.catalogIndex.deleteItem(key)
	} else {
		s.catalogIndex.setItem(key, summary, s.now())
		changed = true
	}
	if !changed {
		s.mu.Unlock()
		return
	}
	itemsCopy := cloneSummaryMap(s.items)
	s.mu.Unlock()

	descriptors := s.Descriptors()
	s.rebuildCacheFromItems(itemsCopy, descriptors)
	s.broadcastStreaming(true)
}

func (s *Service) replaceIngestCatalogSummaries(gvr schema.GroupVersionResource, rows []Summary) {
	if !s.syncMu.TryLock() {
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
	now := s.now()

	s.mu.Lock()
	if s.catalogIndex.items == nil {
		s.catalogIndex.items = make(map[string]Summary)
	}
	if s.catalogIndex.lastSeen == nil {
		s.catalogIndex.lastSeen = make(map[string]time.Time)
	}
	changed := false
	for key, existing := range s.catalogIndex.items {
		if !summaryMatchesDescriptor(existing, desc) {
			continue
		}
		delete(s.catalogIndex.items, key)
		delete(s.catalogIndex.lastSeen, key)
		changed = true
	}
	for _, summary := range rows {
		key := catalogKey(desc, summary.Namespace, summary.Name)
		s.catalogIndex.items[key] = summary
		s.catalogIndex.lastSeen[key] = now
		changed = true
	}
	if changed {
		s.catalogIndex.rebuildLookupIndexes()
	}
	itemsCopy := cloneSummaryMap(s.items)
	s.mu.Unlock()

	if !changed {
		return
	}
	descriptors := s.Descriptors()
	s.rebuildCacheFromItems(itemsCopy, descriptors)
	s.broadcastStreaming(true)
}

func summaryMatchesDescriptor(summary Summary, desc resourceDescriptor) bool {
	return summary.Group == desc.Group &&
		summary.Version == desc.Version &&
		summary.Resource == desc.Resource &&
		summary.Kind == desc.Kind
}

// resolveIngestDescriptor resolves a cut kind's GVR to its catalog descriptor from
// the index, so an incremental sink update keys its summary the same way the collect
// path does.
func (s *Service) resolveIngestDescriptor(gvr schema.GroupVersionResource) (resourceDescriptor, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, desc := s.catalogIndex.resourceForGroupResource(gvr.Group, gvr.Resource)
	if desc == nil {
		return resourceDescriptor{}, false
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
	summaries := make([]Summary, 0, len(rows))
	for _, row := range rows {
		summary, ok := row.(Summary)
		if !ok {
			continue
		}
		summaries = append(summaries, summary)
	}
	s.service.replaceIngestCatalogSummaries(s.gvr, summaries)
}
