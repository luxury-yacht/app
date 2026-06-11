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
	"github.com/luxury-yacht/app/backend/resourcemodel"
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

	// The query path streams entries through the bounded collector (top-K
	// insert, no full materialization or sort); the window path still collects
	// the slice it truncates below.
	var collector *typedTableQueryCollector[ClusterEventEntry]
	var entries []ClusterEventEntry
	if query.Enabled {
		collector = newTypedTableQueryCollector(query, clusterEventTableQueryAdapter())
	} else {
		entries = make([]ClusterEventEntry, 0, len(events))
	}
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
		model := resourcemodel.BuildEventResourceModel(meta.ClusterID, evt)
		facts := model.Facts.Event
		timestamp := resourcemodel.EventTimestamp(evt).Time
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
			Object:           resourcemodel.EventObjectDisplay(evt),
			Message:          resourcemodel.EventMessage(evt),
			Age:              formatAge(timestamp),
			AgeTimestamp:     timestamp.UnixMilli(),
		}
		if collector != nil {
			collector.Add(entry)
		} else {
			entries = append(entries, entry)
		}
		if v := resourceVersionOrTimestamp(evt); v > version {
			version = v
		}
	}

	if query.Enabled {
		page := collector.Page()
		return &refresh.Snapshot{
			Domain:  clusterEventsDomainName,
			Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
			Version: version,
			Payload: ClusterEventsSnapshot{
				ClusterMeta:           meta,
				ResourceQueryEnvelope: typedQueryEnvelope(clusterEventsDomainName, page, clusterEventsQueryCapabilities()),
				Rows:                  page.Rows,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].AgeTimestamp != entries[j].AgeTimestamp {
			return entries[i].AgeTimestamp > entries[j].AgeTimestamp
		}
		return entries[i].Name < entries[j].Name
	})

	originalCount := len(entries)
	if originalCount > config.SnapshotClusterEventsLimit {
		entries = entries[:config.SnapshotClusterEventsLimit]
	}

	stats := refresh.SnapshotStats{
		ItemCount: len(entries),
	}
	if originalCount > len(entries) {
		stats.Truncated = true
		stats.TotalItems = originalCount
		stats.Warnings = []string{fmt.Sprintf("Showing most recent %d of %d events", len(entries), originalCount)}
	}

	return &refresh.Snapshot{
		Domain:  clusterEventsDomainName,
		Version: version,
		Payload: ClusterEventsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedWindowEnvelope(clusterEventsDomainName, originalCount, originalCount == len(entries), snapshotSortedKinds(entries, func(event ClusterEventEntry) string { return event.Kind }), clusterEventsQueryCapabilities()),
			Rows:                  entries,
		},
		Stats: stats,
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
