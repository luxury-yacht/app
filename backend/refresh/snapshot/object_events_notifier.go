package snapshot

import (
	"strings"

	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
)

// ObjectEventsChangeNotifier turns event-informer deliveries into per-object
// doorbells for the object-events domain, replacing the Object Panel Events
// tab's poll (the poll remains only as the stream-down fallback).
//
// It buffers the involved objects' event-index keys — the SAME keys the
// builder's informer index uses (buildObjectEventIndexKey), fed by the SAME
// shared events informer the builder reads — and on each debounced flush hands
// the broadcast sink a matcher over subscribed object scopes. Scope decoding
// goes through refresh.ParseObjectScope, the single object-scope decoder, so
// the cluster-scope sentinel and namespace/kind/name semantics can never drift
// from the builder's.
//
// The flush is a generation callback of the cluster's doorbell, so stopping
// the generation cancels or joins it.
type ObjectEventsChangeNotifier struct {
	changeKeyDebouncer
}

// NewObjectEventsChangeNotifier builds a notifier that rings bell.
func NewObjectEventsChangeNotifier(bell doorbell.Bell) *ObjectEventsChangeNotifier {
	n := &ObjectEventsChangeNotifier{}
	n.changeKeyDebouncer = newChangeKeyDebouncer(bell, "oe", eventDoorbellDebounce,
		func(version string, keys map[string]struct{}) {
			bell.Ring(doorbell.Change{
				Domain:  objectEventsDomain,
				Source:  doorbell.SourceEvent,
				Target:  doorbell.Matching(objectEventsScopeMatcher(keys)),
				Version: version,
			})
		})
	return n
}

func objectEventsScopeMatcher(keys map[string]struct{}) func(scope string) bool {
	return func(scope string) bool {
		identity, err := refresh.ParseObjectScope(scope)
		if err != nil {
			return false
		}
		_, ok := keys[buildObjectEventIndexKey(identity.Namespace, identity.GVK.Kind, identity.Name)]
		return ok
	}
}

// EventChanged records an event informer delivery (add/update/delete) for the
// event's involved object.
func (n *ObjectEventsChangeNotifier) EventChanged(evt *corev1.Event) {
	if n == nil || evt == nil {
		return
	}
	name := strings.TrimSpace(evt.InvolvedObject.Name)
	if name == "" {
		return
	}
	n.record(buildObjectEventIndexKey(evt.InvolvedObject.Namespace, evt.InvolvedObject.Kind, name))
}
