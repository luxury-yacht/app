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
	"github.com/luxury-yacht/app/backend/resourcemodel"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

const namespaceEventsDomainName = "namespace-events"

// NamespaceEventsBuilder constructs summaries for namespace scoped events. In production it
// serves from an informer-fed maintained store (projected at intake by the same
// projectNamespaceEventSummary the list path uses); the eventLister path is the list
// fallback (and the direct-builder unit tests).
type NamespaceEventsBuilder struct {
	eventLister corelisters.EventLister
	maintained  *typedMaintainedStore[EventSummary]
	// eventsSynced reports whether the events informer finished its initial
	// sync; see ClusterEventsBuilder for why listing an unsynced cache is a lie.
	eventsSynced cache.InformerSynced
}

// projectNamespaceEventSummary projects a Kubernetes Event into an EventSummary, or reports
// ok=false to skip it. Namespace events involve namespaced objects, so an event whose
// involved object has no namespace is skipped — the same gate the list path applies. Shared
// by the list path and the maintained-store handler so both project byte-identically. The
// row's Namespace is the involved-object namespace (what the table filters by); the
// Kubernetes event recorder always creates an event in its involved object's namespace, so
// involved-object namespace == event metadata namespace for real events.
func projectNamespaceEventSummary(meta ClusterMeta, event *corev1.Event) (EventSummary, bool) {
	if event == nil || strings.TrimSpace(event.InvolvedObject.Namespace) == "" {
		return EventSummary{}, false
	}
	facts := eventres.BuildFacts(meta.ClusterID, event)
	timestamp := eventres.EventTimestamp(event).Time
	return EventSummary{
		ClusterMeta:      meta,
		Kind:             event.InvolvedObject.Kind,
		Name:             event.Name,
		UID:              string(event.UID),
		ResourceVersion:  event.ResourceVersion,
		Namespace:        event.InvolvedObject.Namespace,
		ObjectNamespace:  event.InvolvedObject.Namespace,
		ObjectUID:        string(event.InvolvedObject.UID),
		ObjectAPIVersion: event.InvolvedObject.APIVersion,
		InvolvedObject:   facts.InvolvedObject,
		Type:             facts.EventType,
		Source:           facts.Source,
		Reason:           facts.Reason,
		Object:           eventres.EventObjectDisplay(event),
		Message:          facts.Message,
		Age:              formatAge(timestamp),
		AgeTimestamp:     timestamp.UnixMilli(),
	}, true
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
		[]string{"name", "kind", "namespace", "type", "source", "reason", "object", "objecttype", "objectname", "message", "age"},
	)
}

// EventSummary captures the essential event fields for display.
type EventSummary struct {
	ClusterMeta
	Kind             string                      `json:"kind"`
	Name             string                      `json:"name"`
	UID              string                      `json:"uid"`
	ResourceVersion  string                      `json:"resourceVersion"`
	Namespace        string                      `json:"namespace"`
	ObjectNamespace  string                      `json:"objectNamespace"`
	ObjectUID        string                      `json:"objectUid"`
	ObjectAPIVersion string                      `json:"objectApiVersion"`
	InvolvedObject   *resourcemodel.ResourceLink `json:"involvedObject,omitempty"`
	Type             string                      `json:"type"`
	Source           string                      `json:"source"`
	Reason           string                      `json:"reason"`
	Object           string                      `json:"object"`
	Message          string                      `json:"message"`
	Age              string                      `json:"age"`
	AgeTimestamp     int64                       `json:"ageTimestamp"`
}

// RegisterNamespaceEventsDomain registers the events domain. It serves from a maintained
// store fed by the shared Events informer (projected at intake by the same
// projectNamespaceEventSummary the list path uses); the handler is registered before the
// factory starts so the sync gate guarantees the store is populated before serve.
func RegisterNamespaceEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory, clusterMeta ClusterMeta) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	eventInformer := factory.Core().V1().Events()

	maintained := newTypedMaintainedStore(clusterMeta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())
	reg.RegisterMaintainedStore(namespaceEventsDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	if err := registerMaintainedInformerHandler(maintained, eventInformer.Informer(),
		func(obj interface{}) (EventSummary, metav1.Object, bool) {
			evt, ok := obj.(*corev1.Event)
			if !ok {
				return EventSummary{}, nil, false
			}
			summary, keep := projectNamespaceEventSummary(clusterMeta, evt)
			return summary, evt, keep
		},
	); err != nil {
		return err
	}

	builder := &NamespaceEventsBuilder{
		eventLister:  eventInformer.Lister(),
		maintained:   maintained,
		eventsSynced: eventInformer.Informer().HasSynced,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceEventsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles event summaries for a namespace.
func (b *NamespaceEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	_ = ctx
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
	var summaries []EventSummary
	var version uint64
	if b.maintained != nil {
		// Serve from the informer-fed store (rows projected + empty-involved-namespace
		// filtered at intake) instead of listing + re-projecting. The store filters by the
		// involved-object namespace, the same field the list path's namespace filter uses.
		ns := ""
		if !parsedScope.AllNamespaces {
			ns = parsedScope.Namespace
		}
		summaries = b.maintained.rowsInNamespace(ns)
		version = b.maintained.snapshotVersion()
	} else {
		var events []*corev1.Event
		if parsedScope.AllNamespaces {
			events, err = b.eventLister.List(labels.Everything())
		} else {
			events, err = b.eventLister.Events(parsedScope.Namespace).List(labels.Everything())
		}
		if err != nil {
			return nil, err
		}
		summaries = make([]EventSummary, 0, len(events))
		for _, event := range events {
			summary, keep := projectNamespaceEventSummary(meta, event)
			if !keep {
				continue
			}
			// For a specific namespace the involved-object namespace must match the
			// request (mirrors the prior filtered step); all-namespaces keeps every row.
			if !parsedScope.AllNamespaces && summary.Namespace != parsedScope.Namespace {
				continue
			}
			summaries = append(summaries, summary)
			if v := resourceVersionOrTimestamp(event); v > version {
				version = v
			}
		}
	}

	// Window-mode order is most-recent-first with a deterministic name tiebreak.
	// Apply it before resolving so the engine's query branch (which sorts by the
	// request's SortField) and the window branch both serve a stable order.
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].AgeTimestamp != summaries[j].AgeTimestamp {
			return summaries[i].AgeTimestamp > summaries[j].AgeTimestamp
		}
		return summaries[i].Name < summaries[j].Name
	})

	resolved := resolveTypedSnapshotPageViaStore(
		namespaceEventsDomainName,
		summaries,
		query,
		namespacedEventTableQueryAdapter(),
		namespaceEventsQuerypageSchema(),
		namespaceEventsQueryCapabilities(),
		config.SnapshotNamespaceEventsLimit,
		"events",
		func(e EventSummary) string { return e.Kind },
		nil,
	)
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
	}, nil
}
