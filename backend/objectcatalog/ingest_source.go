/*
 * backend/objectcatalog/ingest_source.go
 *
 * The catalog reads built-in kinds two ways from their owned reflectors:
 *
 *   - the full collect path reads CatalogRows(gvr) (Summaries projected at intake);
 *   - incremental updates arrive through a Catalog-half ingest Sink that applies the
 *     per-object summary set/delete.
 *
 * SummaryProjector is registered with the ingest manager (before it starts) so the
 * Catalog half of each cut kind's bundle is the exact Summary the live collect path
 * would build — the projection is the one summaryFromObject the Service uses.
 */

package objectcatalog

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
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

// catalogIngestGVRs is the set of built-in GVRs the catalog collects from their
// owned reflectors: every registry kind except those the catalog excludes
// (CatalogNone). Events are excluded, so their row volume never reaches the
// catalog's sink.
var catalogIngestGVRs = collectedIngestGVRs()

func collectedIngestGVRs() map[schema.GroupVersionResource]struct{} {
	out := make(map[schema.GroupVersionResource]struct{})
	for _, descriptor := range kindregistry.All {
		if descriptor.CatalogSource != kindspec.CatalogNone {
			out[descriptor.Identity.GVR()] = struct{}{}
		}
	}
	return out
}

// collectViaIngest serves a built-in kind's full collect from its owned
// reflector's CatalogRows (Summaries projected at intake). It returns
// handled=false (so the caller falls through to the next source) only when the
// kind is not collected from ingest or no ingest source is configured. A
// built-in kind reports an incomplete collect until its store has settled;
// after that, partitions without a synced watch (skipped by the permission
// filter, or degraded) are collected with LIST, like a dynamic source's.
// Summaries for a namespaced kind are filtered to the requested namespaces.
func (s *Service) collectViaIngest(ctx context.Context, desc Descriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	source := s.deps.IngestSource
	if source == nil {
		return nil, false, nil
	}
	gvr := desc.GVR()
	_, staticCut := catalogIngestGVRs[gvr]
	if !staticCut {
		return nil, false, nil
	}
	if !source.HasSyncedFor(gvr) {
		return nil, true, fmt.Errorf("catalog ingest store for %s is not synced", gvr)
	}
	return s.collectIngestPartitions(ctx, desc, namespaces, staticIngestPartitions(source, gvr), agg)
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
// so no source object is needed.
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

// Replace receives the store's whole row set on a subscription replay or a
// relist. Those rows cover only the watched partitions (plus rows restored
// into skipped ones), so the kind is reconciled by partition from its store
// rather than replaced with them.
func (s ingestCatalogSink) Replace([]interface{}) {
	s.service.queueIngestReconciliation(s.gvr)
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

// dropPendingIngestReconciliation removes the queued kinds in gvrs, for a
// caller that owns syncMu and reconciles them itself. Other queued kinds, such
// as custom resources, stay queued for the drain worker.
func (s *Service) dropPendingIngestReconciliation(gvrs map[schema.GroupVersionResource]struct{}) {
	s.ingestPendingMu.Lock()
	defer s.ingestPendingMu.Unlock()
	for gvr := range gvrs {
		delete(s.ingestPending, gvr)
	}
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
