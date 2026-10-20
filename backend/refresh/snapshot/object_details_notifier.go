package snapshot

import (
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
)

// ObjectDetailsChangeNotifier turns response-cache evictions into per-object
// doorbells for the object-details domain, so an open panel refetches its
// details right after they change instead of on its next poll.
//
// Refresh registers the eviction handlers, and each handler evicts the cached
// details before recording the change here, so a signal-triggered read never
// returns the pre-change copy. Callers record only real changes: resync echoes
// and unchanged relist rows must not ring. Keys match at the granularity of
// eviction — one exact GroupVersionKind — with group and kind compared
// case-insensitively. Subscribed scopes are decoded by refresh.ParseObjectScope,
// the single object-scope decoder.
type ObjectDetailsChangeNotifier struct {
	changeKeyDebouncer
}

// NewObjectDetailsChangeNotifier builds a notifier that rings bell.
func NewObjectDetailsChangeNotifier(bell doorbell.Bell) *ObjectDetailsChangeNotifier {
	n := &ObjectDetailsChangeNotifier{}
	n.changeKeyDebouncer = newChangeKeyDebouncer(bell, "od", eventDoorbellDebounce,
		func(version string, keys map[string]struct{}) {
			bell.Ring(doorbell.Change{
				Domain:  objectDetailsDomain,
				Source:  doorbell.SourceObject,
				Target:  doorbell.Matching(objectDetailsScopeMatcher(keys)),
				Version: version,
			})
		})
	return n
}

func objectDetailsScopeMatcher(keys map[string]struct{}) func(scope string) bool {
	return func(scope string) bool {
		identity, err := refresh.ParseObjectScope(scope)
		if err != nil {
			return false
		}
		_, object := keys[objectDetailsKey(identity.GVK, identity.Namespace, identity.Name)]
		_, kind := keys[objectDetailsKindKey(identity.GVK, identity.Namespace)]
		return object || kind
	}
}

// ObjectChanged records a real change to one object's cached details.
func (n *ObjectDetailsChangeNotifier) ObjectChanged(gvk schema.GroupVersionKind, namespace, name string) {
	if n == nil || strings.TrimSpace(name) == "" {
		return
	}
	n.record(objectDetailsKey(gvk, namespace, name))
}

// KindChangedInNamespace records a change to the details of every object of a
// kind in a namespace, such as a Pod change for the kinds whose details list
// their pods.
func (n *ObjectDetailsChangeNotifier) KindChangedInNamespace(gvk schema.GroupVersionKind, namespace string) {
	if n == nil {
		return
	}
	n.record(objectDetailsKindKey(gvk, namespace))
}

func objectDetailsGVKKey(gvk schema.GroupVersionKind) string {
	return strings.ToLower(strings.TrimSpace(gvk.Group)) + "/" + strings.TrimSpace(gvk.Version) + "/" +
		strings.ToLower(strings.TrimSpace(gvk.Kind))
}

// Object and kind keys carry distinct prefixes, so no object name can read as
// a kind key.
func objectDetailsKey(gvk schema.GroupVersionKind, namespace, name string) string {
	return "object|" + objectDetailsGVKKey(gvk) + "|" + strings.TrimSpace(namespace) + "|" + strings.TrimSpace(name)
}

func objectDetailsKindKey(gvk schema.GroupVersionKind, namespace string) string {
	return "kind|" + objectDetailsGVKKey(gvk) + "|" + strings.TrimSpace(namespace)
}
