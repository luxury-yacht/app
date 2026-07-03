package snapshot

import (
	"fmt"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
)

// objectEventsNotifierDebounce coalesces event bursts (a crash-looping pod, a
// rollout) into one doorbell per window.
const objectEventsNotifierDebounce = 500 * time.Millisecond

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
	mu        sync.Mutex
	broadcast func(version string, matches func(scope string) bool)
	timer     *time.Timer
	debounce  time.Duration
	dirty     map[string]struct{}
	counter   uint64
	stopped   bool
}

// NewObjectEventsChangeNotifier builds an unwired notifier; SetBroadcast
// attaches the doorbell sink once the stream manager exists.
func NewObjectEventsChangeNotifier() *ObjectEventsChangeNotifier {
	return &ObjectEventsChangeNotifier{
		debounce: objectEventsNotifierDebounce,
		dirty:    map[string]struct{}{},
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
	n.mu.Lock()
	n.broadcast = broadcast
	pending := len(n.dirty) > 0
	n.mu.Unlock()
	if pending {
		n.arm()
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
	key := buildObjectEventIndexKey(evt.InvolvedObject.Namespace, evt.InvolvedObject.Kind, name)
	n.mu.Lock()
	if n.stopped {
		n.mu.Unlock()
		return
	}
	n.dirty[key] = struct{}{}
	n.mu.Unlock()
	n.arm()
}

// Stop cancels any pending flush; the notifier is discarded with its subsystem.
func (n *ObjectEventsChangeNotifier) Stop() {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.stopped = true
	timer := n.timer
	n.timer = nil
	n.mu.Unlock()
	if timer != nil {
		timer.Stop()
	}
}

func (n *ObjectEventsChangeNotifier) arm() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.stopped || n.timer != nil {
		return
	}
	n.timer = time.AfterFunc(n.debounce, n.flush)
}

func (n *ObjectEventsChangeNotifier) flush() {
	n.mu.Lock()
	n.timer = nil
	if n.stopped {
		n.mu.Unlock()
		return
	}
	broadcast := n.broadcast
	if broadcast == nil {
		// Not wired yet: keep the dirty keys; SetBroadcast re-arms.
		n.mu.Unlock()
		return
	}
	keys := n.dirty
	n.dirty = map[string]struct{}{}
	if len(keys) == 0 {
		n.mu.Unlock()
		return
	}
	n.counter++
	version := fmt.Sprintf("oe-%d", n.counter)
	n.mu.Unlock()

	// keys is read-only from here on; the matcher may run on the broadcast
	// goroutine against every subscribed scope.
	broadcast(version, func(scope string) bool {
		identity, err := refresh.ParseObjectScope(scope)
		if err != nil {
			return false
		}
		_, ok := keys[buildObjectEventIndexKey(identity.Namespace, identity.GVK.Kind, identity.Name)]
		return ok
	})
}

// eventUpdateIsEcho reports whether an informer Update delivery is a resync
// echo (unchanged ResourceVersion) rather than a real event change; without
// this the doorbell fires once per resync period for every object with events.
// Unrecognized objects are treated as real updates — suppression must never
// lose a signal.
func eventUpdateIsEcho(oldObj, newObj interface{}) bool {
	oldEvt, okOld := oldObj.(*corev1.Event)
	newEvt, okNew := newObj.(*corev1.Event)
	if !okOld || !okNew {
		return false
	}
	return oldEvt.ResourceVersion != "" && oldEvt.ResourceVersion == newEvt.ResourceVersion
}
