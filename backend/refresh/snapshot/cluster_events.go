package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

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

const (
	clusterEventsDomainName = "cluster-events"
)

// ClusterEventsBuilder aggregates Kubernetes Events for the cluster tab.
type ClusterEventsBuilder struct {
	eventLister corelisters.EventLister
	// eventsSynced reports whether the events informer finished its initial
	// sync. Events are the highest-cardinality resource in a cluster; listing
	// an UNSYNCED informer silently returns an empty slice, which would publish
	// a confident "zero events" page during the post-connect window.
	eventsSynced cache.InformerSynced
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
		[]string{"name", "kind", "type", "source", "reason", "object", "objecttype", "objectname", "message", "age"},
	)
}

// ClusterEventEntry mirrors the fields consumed by the frontend grid.
type ClusterEventEntry struct {
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

// RegisterClusterEventsDomain registers the cluster events domain.
func RegisterClusterEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterEventsBuilder{
		eventLister:  factory.Core().V1().Events().Lister(),
		eventsSynced: factory.Core().V1().Events().Informer().HasSynced,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterEventsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build gathers recent cluster events.
func (b *ClusterEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterEventsDomainName, "")
	if err != nil {
		return nil, err
	}
	_ = baseScope
	// Wait out the informer's initial sync (bounded by the request context)
	// instead of listing an unsynced cache: the first request after connect is
	// slower, never wrong. A sync that cannot complete within the request
	// deadline is a real failure.
	if b.eventsSynced != nil && !cache.WaitForCacheSync(ctx.Done(), b.eventsSynced) {
		return nil, fmt.Errorf("cluster events cache has not finished syncing")
	}
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	entries := make([]ClusterEventEntry, 0, len(events))
	var version uint64
	for _, evt := range events {
		if evt == nil {
			continue
		}
		// Cluster events involve cluster-scoped objects only; skip namespaced
		// events BEFORE building the (expensive) resource model — they are the
		// overwhelming majority.
		objectNamespace := evt.InvolvedObject.Namespace
		if strings.TrimSpace(objectNamespace) != "" {
			continue
		}
		facts := eventres.BuildFacts(meta.ClusterID, evt)
		timestamp := eventres.EventTimestamp(evt).Time
		eventType := facts.EventType
		if eventType == "" {
			eventType = "-"
		}
		source := facts.Source
		if source == "" {
			source = "-"
		}
		entry := ClusterEventEntry{
			ClusterMeta:      meta,
			Kind:             "Event",
			Name:             evt.Name,
			UID:              string(evt.UID),
			ResourceVersion:  evt.ResourceVersion,
			Namespace:        objectNamespace,
			ObjectNamespace:  objectNamespace,
			ObjectUID:        string(evt.InvolvedObject.UID),
			ObjectAPIVersion: evt.InvolvedObject.APIVersion,
			InvolvedObject:   facts.InvolvedObject,
			Type:             eventType,
			Source:           source,
			Reason:           facts.Reason,
			Object:           eventres.EventObjectDisplay(evt),
			Message:          eventres.EventMessage(evt),
			Age:              formatAge(timestamp),
			AgeTimestamp:     timestamp.UnixMilli(),
		}
		entries = append(entries, entry)
		if v := resourceVersionOrTimestamp(evt); v > version {
			version = v
		}
	}

	// Window-mode order is most-recent-first with a deterministic name tiebreak.
	// Apply it before resolving so the engine's query branch (which sorts by the
	// request's SortField) and the window branch both serve a stable order.
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].AgeTimestamp != entries[j].AgeTimestamp {
			return entries[i].AgeTimestamp > entries[j].AgeTimestamp
		}
		return entries[i].Name < entries[j].Name
	})

	resolved := resolveTypedSnapshotPageViaStore(
		clusterEventsDomainName,
		entries,
		query,
		clusterEventTableQueryAdapter(),
		clusterEventsQuerypageSchema(),
		clusterEventsQueryCapabilities(),
		config.SnapshotClusterEventsLimit,
		"events",
		func(e ClusterEventEntry) string { return e.Kind },
		nil,
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

func eventTimestamp(evt *corev1.Event) time.Time {
	if evt == nil {
		return time.Time{}
	}
	if !evt.EventTime.IsZero() {
		return evt.EventTime.Time
	}
	if !evt.LastTimestamp.IsZero() {
		return evt.LastTimestamp.Time
	}
	if !evt.FirstTimestamp.IsZero() {
		return evt.FirstTimestamp.Time
	}
	return evt.CreationTimestamp.Time
}

func compareEventOrder(left, right *corev1.Event) int {
	leftTimestamp := eventTimestamp(left)
	rightTimestamp := eventTimestamp(right)
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
