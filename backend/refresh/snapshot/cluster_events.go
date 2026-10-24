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

const (
	clusterEventsDomainName = "cluster-events"
)

// ClusterEventsBuilder aggregates Kubernetes Events for the cluster tab. It serves from
// a maintained store fed by the owned events reflector (rows projected at intake and
// kept by clusterEventEntry).
type ClusterEventsBuilder struct {
	maintained *typedMaintainedStore[ClusterEventEntry]
	// eventsSynced reports whether the events store has applied its initial list
	// (and so fed this table). Events are the highest-cardinality resource in a
	// cluster; serving an unfilled store would publish a confident "zero events" or
	// partial page during the post-connect window.
	eventsSynced cache.InformerSynced
}

// clusterEventsAvailableKinds is the single-kind availability set the maintained store
// filters by: every cluster-event row's Kind is the literal "Event".
var clusterEventsAvailableKinds = map[string]bool{"Event": true}

// clusterEventEntry keeps an Events row for the Cluster Events table, or reports ok=false
// to skip it. Cluster events involve cluster-scoped objects only, so an event whose
// involved object carries a namespace is skipped. The Event resource itself remains
// namespaced even when its involved object is cluster-scoped, so Ref.Namespace comes from
// Event metadata while ObjectNamespace comes from the involved object.
func clusterEventEntry(row EventSummary) (ClusterEventEntry, bool) {
	return ClusterEventEntry(row), strings.TrimSpace(row.ObjectNamespace) == ""
}

// ClusterEventsSnapshot is the payload returned to the UI. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type ClusterEventsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterEventEntry `json:"rows"`
}

func clusterEventsQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "type", "source", "reason", "object", "objectType", "objectName", "message", "age"},
		[]string{"kinds"},
		[]string{"kind", "name", "type", "source", "reason", "object", "message"},
		nil, // open kind set (involved-object kinds); no kind dropdown
		typedTableFacetDescriptors(clusterEventTableQueryAdapter().Facets)...,
	)
}

// clusterEventsQuerypageSchema derives the querypage Schema for the cluster events
// table from its typed-table adapter (reusing the adapter's exact sort encoder +
// row key), so the engine orders rows byte-identically to the live executor. The
// sort fields mirror the sortable fields published by clusterEventsQueryCapabilities.
func clusterEventsQuerypageSchema() querypage.Schema[ClusterEventEntry] {
	// Sort field names are lowercased to match the engine's lowercased sort-field
	// lookup (applyTypedTableQueryViaStore lowercases the request field before
	// indexing SortKeys); the adapter's SortValue lowercases the field internally,
	// so "objecttype"/"objectname" still resolve to the right encoders.
	return querypageSchemaFromAdapter(
		clusterEventTableQueryAdapter(),
		lowerTrimAll(clusterEventsQueryCapabilities().SortableFields),
	)
}

// ClusterEventEntry is the Cluster Events table row: the shared Events table row
// under the cluster family's own type.
type ClusterEventEntry EventSummary

// RegisterClusterEventsDomain registers the cluster events domain. It serves from a
// maintained store fed by the owned events reflector: the reflector's table sink keeps
// the rows clusterEventEntry keeps, and the builder waits for the events store's
// initial list. ingestManager is nil in unit tests, where the store has no feed.
//
// The returned notifier rings the table's doorbell on bell after the store applies each
// change.
func RegisterClusterEventsDomain(reg *domain.Registry, ingestManager *ingest.IngestManager, clusterMeta ClusterMeta, bell doorbell.Bell) (*EventTableChangeNotifier, error) {
	notifier := newEventTableChangeNotifier(bell, clusterEventsDomainName, "ce")
	maintained := newTypedMaintainedStore(clusterMeta, clusterEventsQuerypageSchema(), clusterEventTableQueryAdapter())
	reg.RegisterMaintainedStore(clusterEventsDomainName, maintained) // spill/restore across Cold/re-warm
	builder := &ClusterEventsBuilder{maintained: maintained}
	if ingestManager != nil {
		sink := &eventTableSink[ClusterEventEntry]{
			store:    maintained,
			row:      clusterEventEntry,
			summary:  func(row ClusterEventEntry) EventSummary { return EventSummary(row) },
			notifier: notifier,
		}
		if !ingestManager.AddBundleSink(EventGVR, sink) {
			return nil, fmt.Errorf("%s: events ingest store is unavailable", clusterEventsDomainName)
		}
		builder.eventsSynced = func() bool { return ingestManager.RawHasSyncedFor(EventGVR) }
	}
	if err := reg.Register(refresh.DomainConfig{
		Name:          clusterEventsDomainName,
		BuildSnapshot: builder.Build,
	}); err != nil {
		return nil, err
	}
	return notifier, nil
}

// Build gathers recent cluster events.
func (b *ClusterEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterEventsDomainName, "")
	if err != nil {
		return nil, err
	}
	// Wait out the events store's initial list (bounded by the request context)
	// instead of serving an unfilled table: the first request after connect is
	// slower, never wrong. A sync that cannot complete within the request
	// deadline is a real failure.
	if b.eventsSynced != nil && !cache.WaitForCacheSync(ctx.Done(), b.eventsSynced) {
		return nil, fmt.Errorf("cluster events cache has not finished syncing")
	}

	entries, version, err := b.clusterEventEntries()
	if err != nil {
		return nil, err
	}

	// Window-mode order is most-recent-first with a deterministic name tiebreak.
	// Apply it before resolving so the engine's query branch (which sorts by the
	// request's SortField) and the window branch both serve a stable order.
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].AgeTimestamp != entries[j].AgeTimestamp {
			return entries[i].AgeTimestamp > entries[j].AgeTimestamp
		}
		return entries[i].Ref.Name < entries[j].Ref.Name
	})

	resolved := resolveTypedSnapshotPageViaStore(
		clusterEventsDomainName,
		entries,
		query,
		clusterEventTableQueryAdapter(),
		clusterEventsQuerypageSchema(),
		newTypedSnapshotPageConfig(
			clusterEventsQueryCapabilities(),
			config.SnapshotClusterEventsLimit,
			"events",
			func(e ClusterEventEntry) string { return e.Ref.Kind },
			nil,
		),
	)

	// The query branch echoes the raw request scope; the window branch leaves the
	// scope empty (matching the pre-cutover returns for this cluster-scoped domain).
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterEventsDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterEventsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func (b *ClusterEventsBuilder) clusterEventEntries() ([]ClusterEventEntry, uint64, error) {
	if b.maintained == nil {
		return nil, 0, fmt.Errorf("%s: maintained store is not wired", clusterEventsDomainName)
	}
	return b.maintained.rows("", clusterEventsAvailableKinds), b.maintained.snapshotVersion(), nil
}

func compareNumericStrings(left, right string) int {
	left = strings.TrimLeft(left, "0")
	right = strings.TrimLeft(right, "0")
	if left == "" {
		left = "0"
	}
	if right == "" {
		right = "0"
	}

	if len(left) != len(right) {
		if len(left) < len(right) {
			return -1
		}
		return 1
	}
	if left == right {
		return 0
	}
	if left < right {
		return -1
	}
	return 1
}
