package snapshot

import (
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// ObjectEventsChangeNotifier turns events-store changes into per-object
// doorbells for the object-events domain, replacing the Object Panel Events
// tab's poll (the poll remains only as the stream-down fallback).
//
// It is a sink on the SAME events store the builder reads, and buffers each
// changed Event's involved-object key (buildObjectEventIndexKey, the key the
// builder's match follows); on each debounced flush it hands the broadcast
// sink a matcher over subscribed object scopes. Scope decoding goes through
// refresh.ParseObjectScope, the single object-scope decoder, so the
// cluster-scope sentinel and namespace/kind/name semantics can never drift
// from the builder's. A relist re-delivers every Event, so it rings every open
// Events tab once.
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

var _ ingest.BundleSink = (*ObjectEventsChangeNotifier)(nil)

// UpsertBundle records an added or changed Event for its involved object.
func (n *ObjectEventsChangeNotifier) UpsertBundle(bundle ingest.Bundle) { n.eventChanged(bundle) }

// DeleteBundle records a removed Event for its involved object.
func (n *ObjectEventsChangeNotifier) DeleteBundle(bundle ingest.Bundle) { n.eventChanged(bundle) }

func (n *ObjectEventsChangeNotifier) eventChanged(bundle ingest.Bundle) {
	fact, ok := bundle.Aggregate.(*EventFact)
	if n == nil || !ok || fact == nil {
		return
	}
	name := strings.TrimSpace(fact.InvolvedName)
	if name == "" {
		return
	}
	n.record(buildObjectEventIndexKey(fact.InvolvedNamespace, fact.InvolvedKind, name))
}
