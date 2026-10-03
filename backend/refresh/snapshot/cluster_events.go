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
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

const (
	clusterEventsDomainName = "cluster-events"
)

// ClusterEventsBuilder aggregates Kubernetes Events for the cluster tab. In production it
// serves from an informer-fed maintained store (projected at intake by the same
// projectClusterEventEntry the list path uses); the eventLister path is the list fallback
// (and the direct-builder unit tests).
type ClusterEventsBuilder struct {
	eventLister corelisters.EventLister
	maintained  *typedMaintainedStore[ClusterEventEntry]
	// eventsSynced reports whether the maintained store's handler has applied
	// the Events informer's initial list (the informer's own HasSynced turns true
	// before its handlers catch up). Events are the highest-cardinality resource
	// in a cluster; serving an unfilled store would publish a confident "zero
	// events" or partial page during the post-connect window.
	eventsSynced cache.InformerSynced
}

// clusterEventsAvailableKinds is the single-kind availability set the maintained store
// filters by: every cluster-event row's Kind is the literal "Event".
var clusterEventsAvailableKinds = map[string]bool{"Event": true}

// projectClusterEventEntry projects a Kubernetes Event into a ClusterEventEntry, or
// reports ok=false to skip it. Cluster events involve cluster-scoped objects only, so an
// event whose involved object carries a namespace is skipped — the same gate the list path
// applies. The Event resource itself remains namespaced even when its involved object is
// cluster-scoped, so Ref.Namespace comes from Event metadata while ObjectNamespace comes
// from the involved object. Shared by the list path and the maintained-store handler so both
// project byte-identically.
func projectClusterEventEntry(meta ClusterMeta, evt *corev1.Event) (ClusterEventEntry, bool) {
	if evt == nil || strings.TrimSpace(evt.InvolvedObject.Namespace) != "" {
		return ClusterEventEntry{}, false
	}
	return ClusterEventEntry(projectEventRow(meta, evt)), true
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
// maintained store fed by the shared Events informer (projected at intake by the same
// projectClusterEventEntry the list path uses); the handler is registered before the
// factory starts so the sync gate guarantees the store is populated before serve.
//
// The returned notifier rings the table's doorbell after the store applies each change;
// the subsystem wires its broadcast once the resource-stream manager exists.
func RegisterClusterEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory, clusterMeta ClusterMeta) (*EventTableChangeNotifier, error) {
	if factory == nil {
		return nil, fmt.Errorf("shared informer factory is nil")
	}
	eventInformer := factory.Core().V1().Events()

	notifier := newEventTableChangeNotifier(clusterEventsDomainName, "ce")
	maintained := newTypedMaintainedStore(clusterMeta, clusterEventsQuerypageSchema(), clusterEventTableQueryAdapter())
	reg.RegisterMaintainedStore(clusterEventsDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	storeSynced, err := registerMaintainedInformerHandler(maintained, eventInformer.Informer(),
		func(obj interface{}) (ClusterEventEntry, metav1.Object, bool) {
			evt, ok := obj.(*corev1.Event)
			if !ok {
				return ClusterEventEntry{}, nil, false
			}
			entry, keep := projectClusterEventEntry(clusterMeta, evt)
			return entry, evt, keep
		},
		func(entry ClusterEventEntry) { notifier.changed(entry.ObjectNamespace) },
	)
	if err != nil {
		return nil, err
	}

	builder := &ClusterEventsBuilder{
		eventLister:  eventInformer.Lister(),
		maintained:   maintained,
		eventsSynced: storeSynced,
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
	// Wait out the informer's initial sync (bounded by the request context)
	// instead of listing an unsynced cache: the first request after connect is
	// slower, never wrong. A sync that cannot complete within the request
	// deadline is a real failure.
	if b.eventsSynced != nil && !cache.WaitForCacheSync(ctx.Done(), b.eventsSynced) {
		return nil, fmt.Errorf("cluster events cache has not finished syncing")
	}

	entries, version, err := b.clusterEventEntries(meta)
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

func (b *ClusterEventsBuilder) clusterEventEntries(meta ClusterMeta) ([]ClusterEventEntry, uint64, error) {
	if b.maintained != nil {
		// Serve from the informer-fed store (rows already projected + cluster-scope
		// filtered at intake by projectClusterEventEntry) instead of listing + re-projecting.
		return b.maintained.rows("", clusterEventsAvailableKinds), b.maintained.snapshotVersion(), nil
	}
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, 0, err
	}
	entries := make([]ClusterEventEntry, 0, len(events))
	var version uint64
	for _, event := range events {
		// projectClusterEventEntry skips namespaced events (cluster events involve
		// cluster-scoped objects only) BEFORE building the expensive resource model.
		entry, keep := projectClusterEventEntry(meta, event)
		if !keep {
			continue
		}
		entries = append(entries, entry)
		if eventVersion := resourceVersionOrTimestamp(event); eventVersion > version {
			version = eventVersion
		}
	}
	return entries, version, nil
}

// compareEventOrder orders events most-recently-observed first, using the same
// latest-observation time the rows display, with deterministic tie-breaks.
func compareEventOrder(left, right *corev1.Event) int {
	leftTimestamp := eventres.EventTimestamp(left).Time
	rightTimestamp := eventres.EventTimestamp(right).Time
	if !leftTimestamp.Equal(rightTimestamp) {
		if leftTimestamp.After(rightTimestamp) {
			return -1
		}
		return 1
	}

	leftResourceVersion := strings.TrimSpace(left.GetResourceVersion())
	rightResourceVersion := strings.TrimSpace(right.GetResourceVersion())
	if leftResourceVersion != rightResourceVersion {
		if compareNumericStrings(leftResourceVersion, rightResourceVersion) > 0 {
			return -1
		}
		return 1
	}

	leftUID := string(left.GetUID())
	rightUID := string(right.GetUID())
	if leftUID != rightUID {
		if leftUID < rightUID {
			return -1
		}
		return 1
	}

	leftName := strings.TrimSpace(left.GetName())
	rightName := strings.TrimSpace(right.GetName())
	if leftName != rightName {
		if leftName < rightName {
			return -1
		}
		return 1
	}

	return 0
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
