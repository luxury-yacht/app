package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

const namespaceEventsDomainName = "namespace-events"

// NamespaceEventsBuilder constructs summaries for namespace scoped events. In production it
// serves from an informer-fed maintained store (projected at intake by the same
// projectNamespaceEventSummary the list path uses); the eventLister path is the list
// fallback (and the direct-builder unit tests).
type NamespaceEventsBuilder struct {
	eventLister corelisters.EventLister
	maintained  *typedMaintainedStore[EventSummary]
	// eventsSynced reports whether the maintained store's handler has applied the
	// Events informer's initial list; see ClusterEventsBuilder for why.
	eventsSynced cache.InformerSynced
}

// projectNamespaceEventSummary projects a Kubernetes Event into an EventSummary, or reports
// ok=false to skip it. Namespace events involve namespaced objects, so an event whose
// involved object has no namespace is skipped — the same gate the list path applies. Shared
// by the list path and the maintained-store handler so both paths use ObjectNamespace for
// namespace filtering while Ref continues to identify the Event resource itself.
func projectNamespaceEventSummary(meta ClusterMeta, event *corev1.Event) (EventSummary, bool) {
	if event == nil || strings.TrimSpace(event.InvolvedObject.Namespace) == "" {
		return EventSummary{}, false
	}
	return projectEventRow(meta, event), true
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
// store fed by the shared Events informer (projected at intake by the same
// projectNamespaceEventSummary the list path uses); the handler is registered before the
// factory starts so the sync gate guarantees the store is populated before serve.
//
// The returned notifier rings the table's doorbell for each changed involved-object
// namespace after the store applies the change; the subsystem wires its broadcast once
// the resource-stream manager exists.
func RegisterNamespaceEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory, clusterMeta ClusterMeta) (*EventTableChangeNotifier, error) {
	if factory == nil {
		return nil, fmt.Errorf("shared informer factory is nil")
	}
	eventInformer := factory.Core().V1().Events()

	notifier := newEventTableChangeNotifier(namespaceEventsDomainName, "ne")
	maintained := newTypedMaintainedStore(clusterMeta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())
	reg.RegisterMaintainedStore(namespaceEventsDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	storeSynced, err := registerMaintainedInformerHandler(maintained, eventInformer.Informer(),
		func(obj interface{}) (EventSummary, metav1.Object, bool) {
			evt, ok := obj.(*corev1.Event)
			if !ok {
				return EventSummary{}, nil, false
			}
			summary, keep := projectNamespaceEventSummary(clusterMeta, evt)
			return summary, evt, keep
		},
		func(summary EventSummary) { notifier.changed(summary.ObjectNamespace) },
	)
	if err != nil {
		return nil, err
	}

	builder := &NamespaceEventsBuilder{
		eventLister:  eventInformer.Lister(),
		maintained:   maintained,
		eventsSynced: storeSynced,
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
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), "namespace scope is required")
	if err != nil {
		return nil, err
	}
	// Wait out the informer's initial sync (bounded by the request context)
	// instead of listing an unsynced cache: the first request after connect is
	// slower, never wrong. See ClusterEventsBuilder.Build.
	if b.eventsSynced != nil && !cache.WaitForCacheSync(ctx.Done(), b.eventsSynced) {
		return nil, fmt.Errorf("namespace events cache has not finished syncing")
	}
	summaries, version, err := b.collectNamespaceEventSummaries(meta, parsedScope)
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

func (b *NamespaceEventsBuilder) collectNamespaceEventSummaries(meta ClusterMeta, parsedScope NamespaceSnapshotScope) ([]EventSummary, uint64, error) {
	if b.maintained != nil {
		// Serve from the informer-fed store (rows projected + empty-involved-namespace
		// filtered at intake) instead of listing + re-projecting. The adapter filters by
		// ObjectNamespace without changing the Event resource identity in Ref.
		ns := ""
		if !parsedScope.AllNamespaces {
			ns = parsedScope.Namespace
		}
		return b.maintained.rowsInNamespace(ns), b.maintained.snapshotVersion(), nil
	}
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, 0, err
	}
	summaries, version := projectNamespaceEventSummaries(meta, events, parsedScope)
	return summaries, version, nil
}

func projectNamespaceEventSummaries(meta ClusterMeta, events []*corev1.Event, parsedScope NamespaceSnapshotScope) ([]EventSummary, uint64) {
	summaries := make([]EventSummary, 0, len(events))
	var version uint64
	for _, event := range events {
		summary, keep := projectNamespaceEventSummary(meta, event)
		if !keep || (!parsedScope.AllNamespaces && summary.ObjectNamespace != parsedScope.Namespace) {
			continue
		}
		summaries = append(summaries, summary)
		if value := resourceVersionOrTimestamp(event); value > version {
			version = value
		}
	}
	return summaries, version
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
