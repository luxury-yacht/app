package snapshot

import (
	"sort"

	"github.com/luxury-yacht/app/backend/refresh/doorbell"
)

// EventTableChangeNotifier rings one event table's doorbell (cluster-events or
// namespace-events) after that table's maintained store has applied an Event
// change. It is fed by the table's own events sink, after the sink applies the
// change, so a refetch the doorbell triggers always reads the post-change store.
//
// Keys are involved-object namespaces ("" for a cluster-scoped object), which
// is the scope a table row is served under. Bursts coalesce on the same
// debounce as the object-events doorbell.
type EventTableChangeNotifier struct {
	changeKeyDebouncer
	domain string
}

func newEventTableChangeNotifier(bell doorbell.Bell, domain, versionPrefix string) *EventTableChangeNotifier {
	n := &EventTableChangeNotifier{domain: domain}
	n.changeKeyDebouncer = newChangeKeyDebouncer(bell, versionPrefix, eventDoorbellDebounce,
		func(version string, keys map[string]struct{}) {
			bell.Ring(doorbell.Change{
				Domain:  domain,
				Source:  doorbell.SourceEvent,
				Target:  doorbell.Scopes(eventTableDoorbellScopes(domain, keys)...),
				Version: version,
			})
		})
	return n
}

// eventTableDoorbellScopes maps changed involved-object namespaces to the
// scopes the table is viewed at: Cluster Events has the one cluster scope;
// Namespace Events rings each changed namespace and All Namespaces.
func eventTableDoorbellScopes(domain string, namespaces map[string]struct{}) []string {
	if domain == clusterEventsDomainName {
		return clusterDoorbellScopes()
	}
	sorted := make([]string, 0, len(namespaces))
	for namespace := range namespaces {
		sorted = append(sorted, namespace)
	}
	sort.Strings(sorted)
	scopes := make([]string, 0, 2*len(sorted))
	for _, namespace := range sorted {
		scopes = append(scopes, namespaceDoorbellScopes(namespace)...)
	}
	return scopes
}

func (n *EventTableChangeNotifier) changed(objectNamespace string) {
	if n == nil {
		return
	}
	n.record(objectNamespace)
}
