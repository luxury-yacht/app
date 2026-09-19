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
			n.sendCustomResource(ref)
		}
	})
}

// Custom notifications carry identity, not historical payloads. Retain one read
// per identity while initial collection or registration prevents draining; a
// large initial informer replay must not overflow the bounded payload queue.
func (n *watchNotifier) sendCustomResource(ref resourcemodel.ResourceRef) {
	// Recreated objects share one pending read of the current authoritative UID.
	ref.UID = ""
	n.customMu.Lock()
	if n.customPending == nil {
		n.customPending = make(map[resourcemodel.ResourceRef]struct{})
	}
	n.customPending[ref] = struct{}{}
	n.customMu.Unlock()
	select {
	case n.customChanged <- struct{}{}:
	default:
	}
}

func (n *watchNotifier) takeCustomResourceEvents() []watchEvent {
	n.customMu.Lock()
	pending := n.customPending
	n.customPending = nil
	n.customMu.Unlock()
	events := make([]watchEvent, 0, len(pending))
	for ref := range pending {
		events = append(events, watchEvent{ref: &ref})
	}
	return events
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
	// The informer may use a served storage version while discovery prefers a
	// different version. Read with the source ref, then publish catalog identity.
	gvr, desc := n.service.resolveGRToDescriptor(schema.GroupResource{Group: ref.Group, Resource: ref.Resource})
	if desc == nil {
		return watchEvent{}, false
	}
	event := watchEvent{eventType: watchEventUpdate, gvr: gvr, key: catalogKey(*desc, ref.Namespace, ref.Name), obj: object}
	if object == nil {
		event.eventType = watchEventDelete
	}
	return event, true
}
