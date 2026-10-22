package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

const namespaceEventsDomainName = "namespace-events"

// NamespaceEventsBuilder constructs summaries for namespace scoped events. It serves from
// a maintained store fed by the owned events reflector (rows projected at intake and kept
// by namespaceEventSummary).
type NamespaceEventsBuilder struct {
	maintained *typedMaintainedStore[EventSummary]
	// eventsSynced reports whether the events store has applied its initial list;
	// see ClusterEventsBuilder for why.
	eventsSynced cache.InformerSynced
}

// namespaceEventSummary keeps an Events row for the Namespace Events table, or reports
// ok=false to skip it. Namespace events involve namespaced objects, so an event whose
// involved object has no namespace is skipped. The table filters by ObjectNamespace while
// Ref continues to identify the Event resource itself.
func namespaceEventSummary(row EventSummary) (EventSummary, bool) {
	return row, strings.TrimSpace(row.ObjectNamespace) != ""
}

// NamespaceEventsSnapshot payload for events tab.
type NamespaceEventsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []EventSummary `json:"rows"`
}

func namespaceEventsQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "type", "source", "reason", "object", "objectType", "objectName", "message", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "type", "source", "reason", "object", "message"},
		nil, // open kind set (involved-object kinds); no kind dropdown
		typedTableFacetDescriptors(namespacedEventTableQueryAdapter().Facets)...,
	)
}

// namespaceEventsQuerypageSchema derives the querypage Schema for the namespace
// events table from its typed-table adapter (reusing the adapter's exact sort
// encoder + row key), so the engine orders rows byte-identically to the live
// executor. The sort fields mirror the sortable fields published by
// namespaceEventsQueryCapabilities.
func namespaceEventsQuerypageSchema() querypage.Schema[EventSummary] {
	// Sort field names are lowercased to match the engine's lowercased sort-field
	// lookup (applyTypedTableQueryViaStore lowercases the request field before
	// indexing SortKeys); the adapter's SortValue lowercases the field internally,
	// so "objecttype"/"objectname" still resolve to the right encoders.
	return querypageSchemaFromAdapter(
		namespacedEventTableQueryAdapter(),
		lowerTrimAll(namespaceEventsQueryCapabilities().SortableFields),
	)
}

// RegisterNamespaceEventsDomain registers the events domain. It serves from a maintained
// store fed by the owned events reflector: the reflector's table sink keeps the rows
// namespaceEventSummary keeps, and the builder waits for the events store's initial list.
// ingestManager is nil in unit tests, where the store has no feed.
//
// The returned notifier rings the table's doorbell on bell for each changed
// involved-object namespace after the store applies the change.
func RegisterNamespaceEventsDomain(reg *domain.Registry, ingestManager *ingest.IngestManager, clusterMeta ClusterMeta, bell doorbell.Bell) (*EventTableChangeNotifier, error) {
	notifier := newEventTableChangeNotifier(bell, namespaceEventsDomainName, "ne")
	maintained := newTypedMaintainedStore(clusterMeta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())
	reg.RegisterMaintainedStore(namespaceEventsDomainName, maintained) // spill/restore across Cold/re-warm
	builder := &NamespaceEventsBuilder{maintained: maintained}
	if ingestManager != nil {
		sink := &eventTableSink[EventSummary]{
			store:    maintained,
			row:      namespaceEventSummary,
			summary:  func(row EventSummary) EventSummary { return row },
			notifier: notifier,
		}
		if !ingestManager.AddBundleSink(EventGVR, sink) {
			return nil, fmt.Errorf("%s: events ingest store is unavailable", namespaceEventsDomainName)
		}
		builder.eventsSynced = func() bool { return ingestManager.RawHasSyncedFor(EventGVR) }
	}
	if err := reg.Register(refresh.DomainConfig{
		Name:          namespaceEventsDomainName,
		BuildSnapshot: builder.Build,
	}); err != nil {
		return nil, err
	}
	return notifier, nil
}

// Build assembles event summaries for a namespace.
func (b *NamespaceEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceEventsDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(namespaceEventsDomainName, clusterID, baseScope, "namespace scope is required")
	if err != nil {
		return nil, err
	}
	// Wait out the events store's initial list (bounded by the request context)
	// instead of serving an unfilled table: the first request after connect is
	// slower, never wrong. See ClusterEventsBuilder.Build.
	if b.eventsSynced != nil && !cache.WaitForCacheSync(ctx.Done(), b.eventsSynced) {
		return nil, fmt.Errorf("namespace events cache has not finished syncing")
	}
	summaries, version, err := b.collectNamespaceEventSummaries(parsedScope)
	if err != nil {
		return nil, err
	}
	sortNamespaceEventSummaries(summaries)
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceEventsDomainName,
		summaries,
		query,
		namespacedEventTableQueryAdapter(),
		namespaceEventsQuerypageSchema(),
		newTypedSnapshotPageConfig(
			namespaceEventsQueryCapabilities(),
			config.SnapshotNamespaceEventsLimit,
			"events",
			func(e EventSummary) string { return e.ObjectKind },
			nil,
		),
	)

	return namespaceEventsSnapshot(meta, clusterID, trimmed, parsedScope, query, resolved, version), nil
}

func (b *NamespaceEventsBuilder) collectNamespaceEventSummaries(parsedScope NamespaceSnapshotScope) ([]EventSummary, uint64, error) {
	if b.maintained == nil {
		return nil, 0, fmt.Errorf("%s: maintained store is not wired", namespaceEventsDomainName)
	}
	// The adapter filters by ObjectNamespace without changing the Event resource
	// identity in Ref.
	ns := ""
	if !parsedScope.AllNamespaces {
		ns = parsedScope.Namespace
	}
	return b.maintained.rowsInNamespace(ns), b.maintained.snapshotVersion(), nil
}

func sortNamespaceEventSummaries(summaries []EventSummary) {
	// Window-mode order is most-recent-first with a deterministic name tiebreak.
	// Apply it before resolving so the engine's query branch (which sorts by the
	// request's SortField) and the window branch both serve a stable order.
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].AgeTimestamp != summaries[j].AgeTimestamp {
			return summaries[i].AgeTimestamp > summaries[j].AgeTimestamp
		}
		return summaries[i].Ref.Name < summaries[j].Ref.Name
	})
}

func namespaceEventsSnapshot(meta ClusterMeta, clusterID, trimmed string, parsedScope NamespaceSnapshotScope, query typedTableQuery, resolved typedSnapshotPage[EventSummary], version uint64) *refresh.Snapshot {
	// The query branch echoes the raw request scope; the window branch reports the
	// canonical namespace scope (matching the pre-cutover returns).
	snapshotScope := parsedScope.CanonicalScope
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  namespaceEventsDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: NamespaceEventsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}
}
