package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
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

// NamespaceEventsBuilder constructs summaries for namespace scoped events.
type NamespaceEventsBuilder struct {
	eventLister corelisters.EventLister
	// eventsSynced reports whether the events informer finished its initial
	// sync; see ClusterEventsBuilder for why listing an unsynced cache is a lie.
	eventsSynced cache.InformerSynced
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

// RegisterNamespaceEventsDomain registers the events domain.
func RegisterNamespaceEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceEventsBuilder{
		eventLister:  factory.Core().V1().Events().Lister(),
		eventsSynced: factory.Core().V1().Events().Informer().HasSynced,
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
	var (
		events []*corev1.Event
	)
	if parsedScope.AllNamespaces {
		events, err = b.eventLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
	} else {
		events, err = b.eventLister.Events(parsedScope.Namespace).List(labels.Everything())
		if err != nil {
			return nil, err
		}
	}

	filtered := make([]*corev1.Event, 0, len(events))
	for _, event := range events {
		if event == nil {
			continue
		}
		eventNamespace := strings.TrimSpace(event.InvolvedObject.Namespace)
		if eventNamespace == "" {
			continue
		}
		if !parsedScope.AllNamespaces && eventNamespace != parsedScope.Namespace {
			continue
		}
		filtered = append(filtered, event)
	}
	events = filtered

	summaries := make([]EventSummary, 0, len(events))
	var version uint64

	for _, event := range events {
		if event == nil {
			continue
		}
		if event.InvolvedObject.Namespace == "" {
			continue
		}
		facts := eventres.BuildFacts(meta.ClusterID, event)
		timestamp := eventres.EventTimestamp(event).Time
		summary := EventSummary{
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
		}
		summaries = append(summaries, summary)
		if v := resourceVersionOrTimestamp(event); v > version {
			version = v
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
