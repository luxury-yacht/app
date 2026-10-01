package snapshot

import (
	"strings"

	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
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
// Inputs may fire from informer goroutines; the broadcast sink is wired later
// (the resource-stream manager is built after domain registration), so pending
// keys are retained until SetBroadcast arrives.
type ObjectEventsChangeNotifier struct {
	changeKeyDebouncer
}

// NewObjectEventsChangeNotifier builds an unwired notifier; SetBroadcast
// attaches the doorbell sink once the stream manager exists.
func NewObjectEventsChangeNotifier() *ObjectEventsChangeNotifier {
	return &ObjectEventsChangeNotifier{
		changeKeyDebouncer: newChangeKeyDebouncer("oe", eventDoorbellDebounce),
	}
}

// SetBroadcast wires the doorbell sink. Keys recorded before wiring are
// flushed on the next debounce tick.
func (n *ObjectEventsChangeNotifier) SetBroadcast(
	broadcast func(version string, matches func(scope string) bool),
) {
	if n == nil {
		return
	}
	if broadcast == nil {
		n.setSink(nil)
		return
	}
	n.setSink(func(version string, keys map[string]struct{}) {
		broadcast(version, func(scope string) bool {
			identity, err := refresh.ParseObjectScope(scope)
			if err != nil {
				return false
			}
			_, ok := keys[buildObjectEventIndexKey(identity.Namespace, identity.GVK.Kind, identity.Name)]
			return ok
		})
	})
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

// Stop cancels any pending flush; the notifier is discarded with its subsystem.
func (n *ObjectEventsChangeNotifier) Stop() {
	if n == nil {
		return
	}
	n.stop()
}
