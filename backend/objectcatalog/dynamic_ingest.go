package objectcatalog

import (
	"context"
	"slices"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func (s *Service) collectViaDynamicIngest(ctx context.Context, desc Descriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	if s.deps.IngestSource == nil {
		return nil, false, nil
	}
	source, ok := s.deps.IngestSource.ReadDynamicCatalogSource(desc.GVR().GroupResource())
	if !ok {
		return nil, false, nil
	}
	return s.collectIngestPartitions(ctx, desc, namespaces, ingestPartitions{rows: source.Rows, ready: source.ReadyNamespaces}, agg)
}

// ingestPartitions is one read of an ingest source's catalog rows and the
// namespaces whose watch has synced ("" = every namespace). A row outside them
// is not a watched row: it was restored from spill, or it belongs to a
// partition the permission filter skipped.
type ingestPartitions struct {
	rows  []interface{}
	ready []string
}

// staticIngestPartitions reads a built-in kind's rows with the namespaces whose
// partitions report Ready.
func staticIngestPartitions(source IngestSource, gvr schema.GroupVersionResource) ingestPartitions {
	ready := make([]string, 0)
	for _, part := range source.PartitionReadinessFor(gvr) {
		if part.State == refresh.ResourceReadinessReady {
			ready = append(ready, part.Namespace)
		}
	}
	return ingestPartitions{rows: source.CatalogRows(gvr), ready: ready}
}

func (p ingestPartitions) watched(namespace string) bool {
	return slices.Contains(p.ready, "") || slices.Contains(p.ready, namespace)
}

func (p ingestPartitions) pending(targets []string) []string {
	pending := make([]string, 0, len(targets))
	for _, namespace := range targets {
		if !p.watched(namespace) {
			pending = append(pending, namespace)
		}
	}
	return pending
}

// collectIngestPartitions serves the watched partitions from the ingest rows
// and LISTs every other requested target: a not-yet-watched or LIST-only
// partition must be collected, not interpreted as empty. Each API page has its
// own budget, independent of reflector retries.
func (s *Service) collectIngestPartitions(ctx context.Context, desc Descriptor, namespaces []string, partitions ingestPartitions, agg *streamingAggregator) ([]Summary, bool, error) {
	pending := partitions.pending(listTargets(desc, namespaces))
	rows := s.watchedCatalogSummaries(partitions, desc, namespaces)
	if len(pending) > 0 {
		listed, err := s.listResourceTargets(ctx, desc, pending, nil)
		if err != nil {
			return nil, true, err
		}
		if slices.Contains(pending, "") {
			rows = nil
		}
		rows = append(rows, listed...)
	}
	return emitSummaries(agg, rows, nil, true)
}

func (s *Service) watchedCatalogSummaries(partitions ingestPartitions, desc Descriptor, namespaces []string) []Summary {
	rows := catalogSummaries(partitions.rows, requestedNamespaceSet(desc, namespaces))
	selected := rows[:0]
	for _, row := range rows {
		if row.Ref.ClusterID != s.clusterID || !partitions.watched(row.Ref.Namespace) {
			continue
		}
		// A reflector can serve another CRD version; catalog identity continues to
		// use the discovered descriptor selected for queries and object navigation.
		selected = append(selected, dynamicSummaryIdentity(row, desc))
	}
	return selected
}

// The caller owns syncMu. Read the current source only after taking publication
// ownership, so queued events from retired versions cannot overwrite replacements.
func (s *Service) reconcileCurrentIngestSource(gvr schema.GroupVersionResource) {
	partitions, live := s.currentIngestPartitions(gvr)
	if !live {
		// The source was retired (its CRD was deleted): drop its rows.
		s.replaceIngestCatalogSummariesLocked(gvr, nil)
		return
	}
	desc, ok := s.resolveIngestDescriptor(gvr)
	if !ok || len(partitions.ready) == 0 {
		return
	}
	rows := s.watchedCatalogSummaries(partitions, desc, s.scopeNamespaces())
	// A watch baseline replaces only synced partitions. Retain LIST-only and
	// pending partitions until their own catalog collection succeeds.
	s.mu.RLock()
	for _, existing := range s.catalogIndex.items {
		if summaryMatchesDescriptor(existing, desc) && !partitions.watched(existing.Ref.Namespace) {
			rows = append(rows, existing)
		}
	}
	s.mu.RUnlock()
	s.replaceIngestCatalogSummariesLocked(gvr, rows)
}

// currentIngestPartitions reads gvr's live source: a runtime-discovered source,
// or a built-in kind's store. It reports false when neither exists.
func (s *Service) currentIngestPartitions(gvr schema.GroupVersionResource) (ingestPartitions, bool) {
	if source, dynamic := s.deps.IngestSource.ReadDynamicCatalogSource(gvr.GroupResource()); dynamic {
		return ingestPartitions{rows: source.Rows, ready: source.ReadyNamespaces}, true
	}
	if _, builtin := catalogIngestGVRs[gvr]; builtin {
		return staticIngestPartitions(s.deps.IngestSource, gvr), true
	}
	return ingestPartitions{}, false
}

func dynamicSummaryIdentity(row Summary, desc Descriptor) Summary {
	row.Ref.Group, row.Ref.Version, row.Ref.Kind, row.Ref.Resource = desc.Group, desc.Version, desc.Kind, desc.Resource
	row.Scope = desc.Scope
	return row
}

func (s *Service) applyDynamicCatalogChange(change ingest.DynamicCatalogChange) {
	gvr := change.Source.GVR
	if change.Row == nil || !s.syncMu.TryLock() {
		s.queueIngestReconciliation(gvr)
		return
	}
	defer s.syncMu.Unlock()
	if !s.deps.IngestSource.IsDynamicCatalogGeneration(gvr.GroupResource(), change.Generation) {
		return
	}
	desc, ok := s.resolveIngestDescriptor(gvr)
	if !ok {
		return
	}
	row, ok := change.Row.(Summary)
	if !ok || row.Ref.ClusterID != s.clusterID {
		return
	}
	row = dynamicSummaryIdentity(row, desc)
	s.publishIngestSummary(desc, row, change.Deleted)
}
