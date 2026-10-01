package snapshot

import "sort"

// EventTableChangeNotifier rings one event table's doorbell (cluster-events or
// namespace-events) after that table's maintained store has applied an Event
// change. It is fed by the store's own informer handler, so a refetch the
// doorbell triggers always reads the post-change store; a separate informer
// handler would race the store's listener.
//
// Keys are involved-object namespaces ("" for a cluster-scoped object), which
// is the scope a table row is served under. Bursts coalesce on the same
// debounce as the object-events doorbell.
type EventTableChangeNotifier struct {
	changeKeyDebouncer
	domain string
}

func newEventTableChangeNotifier(domain, versionPrefix string) *EventTableChangeNotifier {
	return &EventTableChangeNotifier{
		changeKeyDebouncer: newChangeKeyDebouncer(versionPrefix, eventDoorbellDebounce),
		domain:             domain,
	}
}

// Domain names the refresh domain whose doorbell this notifier rings.
func (n *EventTableChangeNotifier) Domain() string {
	if n == nil {
		return ""
	}
	return n.domain
}

// SetBroadcast wires the doorbell sink with the sorted set of changed
// involved-object namespaces. Changes recorded before wiring are flushed on the
// next debounce tick.
func (n *EventTableChangeNotifier) SetBroadcast(broadcast func(version string, namespaces []string)) {
	if n == nil {
		return
	}
	if broadcast == nil {
		n.setSink(nil)
		return
	}
	n.setSink(func(version string, keys map[string]struct{}) {
		namespaces := make([]string, 0, len(keys))
		for namespace := range keys {
			namespaces = append(namespaces, namespace)
		}
		sort.Strings(namespaces)
		broadcast(version, namespaces)
	})
}

// Stop cancels any pending flush; the notifier is discarded with its subsystem.
func (n *EventTableChangeNotifier) Stop() {
	if n == nil {
		return
	}
	n.stop()
}

func (n *EventTableChangeNotifier) changed(objectNamespace string) {
	if n == nil {
		return
	}
	n.record(objectNamespace)
}
