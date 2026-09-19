package objectcatalog

import (
	"context"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func (n *watchNotifier) subscribeCustomResources(ctx context.Context) func() {
	source := n.service.deps.CustomResourceSource
	if source == nil {
		return func() {
			// Without a custom-resource source there is no subscription to remove.
		}
	}
	return source.SubscribeCustomResourceChanges(func(ref resourcemodel.ResourceRef) {
		if ctx.Err() == nil && ref.ClusterID == n.service.clusterID {
			n.send(watchEvent{ref: &ref})
		}
	})
}

// Resolve only after acquiring syncMu. Queued events may predate a full sync or
// object recreation, so use current watch state instead of the event payload.
func (n *watchNotifier) resolveCustomResourceEvents(events []watchEvent) []watchEvent {
	resolved := make([]watchEvent, 0, len(events))
	for _, event := range events {
		if event.ref == nil {
			resolved = append(resolved, event)
			continue
		}
		if current, ok := n.currentCustomResourceEvent(*event.ref); ok {
			resolved = append(resolved, current)
		} else {
			n.requestFullSync(1, false)
		}
	}
	return resolved
}

func (n *watchNotifier) currentCustomResourceEvent(ref resourcemodel.ResourceRef) (watchEvent, bool) {
	object, ready := n.service.deps.CustomResourceSource.WatchedCustomResource(ref)
	if !ready {
		return watchEvent{}, false
	}
	gvr := schema.GroupVersionResource{Group: ref.Group, Version: ref.Version, Resource: ref.Resource}.String()
	n.service.mu.RLock()
	desc, found := n.service.catalogIndex.resource(gvr)
	n.service.mu.RUnlock()
	if !found {
		return watchEvent{}, false
	}
	event := watchEvent{eventType: watchEventUpdate, gvr: gvr, key: catalogKey(desc, ref.Namespace, ref.Name), obj: object}
	if object == nil {
		event.eventType = watchEventDelete
	}
	return event, true
}
