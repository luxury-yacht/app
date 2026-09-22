package objectcatalog

import (
	"context"
	"slices"

	"github.com/luxury-yacht/app/backend/internal/config"
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
	pending := pendingDynamicNamespaces(source, listTargets(desc, namespaces))
	rows := s.dynamicCatalogSummaries(source, desc, namespaces)
	if len(pending) > 0 {
		// A not-yet-watched or LIST-only partition must be collected, not interpreted
		// as empty. A stuck initial read is bounded independently of reflector retries.
		listCtx, cancel := context.WithTimeout(ctx, config.ResourceFetchCallTimeout)
		defer cancel()
		listed, err := s.listResourceTargets(listCtx, desc, pending, nil)
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

func pendingDynamicNamespaces(source ingest.DynamicCatalogSnapshot, targets []string) []string {
	pending := make([]string, 0, len(targets))
	for _, namespace := range targets {
		if !dynamicNamespaceReady(source, namespace) {
			pending = append(pending, namespace)
		}
	}
	return pending
}

func dynamicNamespaceReady(source ingest.DynamicCatalogSnapshot, namespace string) bool {
	return slices.Contains(source.ReadyNamespaces, "") || slices.Contains(source.ReadyNamespaces, namespace)
}

func (s *Service) dynamicCatalogSummaries(source ingest.DynamicCatalogSnapshot, desc Descriptor, namespaces []string) []Summary {
	rows := catalogSummaries(source.Rows, requestedNamespaceSet(desc, namespaces))
	selected := rows[:0]
	for _, row := range rows {
		if row.Ref.ClusterID != s.clusterID || !dynamicNamespaceReady(source, row.Ref.Namespace) {
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
	source, dynamic := s.deps.IngestSource.ReadDynamicCatalogSource(gvr.GroupResource())
	if !dynamic {
		s.replaceIngestCatalogSummariesLocked(gvr, catalogSummaries(s.deps.IngestSource.CatalogRows(gvr), nil))
		return
	}
	desc, ok := s.resolveIngestDescriptor(gvr)
	if !ok || len(source.ReadyNamespaces) == 0 {
		return
	}
	rows := s.dynamicCatalogSummaries(source, desc, s.scopeNamespaces())
	// A watch baseline replaces only synced partitions. Retain LIST-only and
	// pending partitions until their own catalog collection succeeds.
	s.mu.RLock()
	for _, existing := range s.catalogIndex.items {
		if summaryMatchesDescriptor(existing, desc) && !dynamicNamespaceReady(source, existing.Ref.Namespace) {
			rows = append(rows, existing)
		}
	}
	s.mu.RUnlock()
	s.replaceIngestCatalogSummariesLocked(gvr, rows)
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
