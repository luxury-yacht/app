package snapshot

import (
	"sort"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// storePublication rings a maintained store's domain after the store has
// applied a change (docs/architecture/data-freshness.md, "Signals and source
// clocks"). It rings the scopes the changed object left as well as the ones it
// entered, plus the changes of any domain whose serve-time join reads it.
type storePublication struct {
	bell   doorbell.Bell
	domain string
	// clusterScoped rings the cluster scope instead of namespace scopes.
	clusterScoped bool
	// identity, when set, gives rings a complete diagnostic Ref.
	identity *streamspec.Descriptor
	meta     ClusterMeta
	// derived maps one object state to other domains' changes.
	derived func(obj metav1.Object) []doorbell.Change
}

// forDescriptor is the publication for one descriptor kind of the domain.
func (p storePublication) forDescriptor(d streamspec.Descriptor) storePublication {
	p.clusterScoped = d.ClusterScoped
	p.identity = &d
	return p
}

func (p storePublication) scopes(namespace string) []string {
	if p.clusterScoped {
		return clusterDoorbellScopes()
	}
	return namespaceDoorbellScopes(namespace)
}

// objectChanged publishes one applied change. before is nil for an add and
// after is nil for a delete.
func (p storePublication) objectChanged(before, after metav1.Object, kind doorbell.MessageType) {
	current := after
	if current == nil {
		current = before
	}
	if current == nil {
		return
	}
	scopes := p.scopes(current.GetNamespace())
	if before != nil {
		scopes = append(scopes, p.scopes(before.GetNamespace())...)
	}
	p.bell.Ring(doorbell.Change{
		Domain:          p.domain,
		Source:          doorbell.SourceObject,
		Target:          doorbell.Scopes(scopes...),
		Type:            kind,
		Ref:             p.ref(current),
		ResourceVersion: current.GetResourceVersion(),
	})
	for _, change := range p.derivedChanges(before, after) {
		p.bell.Ring(change)
	}
}

// rowRemoved publishes a row dropped without an informer delivery, such as a
// restored row Reconcile found deleted while the cluster was Cold.
func (p storePublication) rowRemoved(namespace string) {
	p.bell.Ring(doorbell.Change{
		Domain: p.domain,
		Source: doorbell.SourceObject,
		Target: doorbell.Scopes(p.scopes(namespace)...),
		Type:   doorbell.MessageTypeDeleted,
	})
}

func (p storePublication) ref(obj metav1.Object) *resourcemodel.ResourceRef {
	if p.identity == nil {
		return nil
	}
	d := p.identity
	ref := resourcemodel.NewResourceRef(resourcemodel.ResourceRef{
		ClusterID: p.meta.ClusterID, Group: d.Group, Version: d.Version, Kind: d.Kind, Resource: d.Resource,
		Namespace: obj.GetNamespace(), Name: obj.GetName(), UID: string(obj.GetUID()),
	})
	return &ref
}

// derivedChanges merges the derived changes of both object states into one
// change per domain, so a retarget rings the old and new targets together.
func (p storePublication) derivedChanges(before, after metav1.Object) []doorbell.Change {
	if p.derived == nil {
		return nil
	}
	var changes []doorbell.Change
	for _, obj := range []metav1.Object{before, after} {
		if obj != nil {
			changes = append(changes, p.derived(obj)...)
		}
	}
	return mergeByDomain(changes)
}

// mergeByDomain folds explicit-scope changes into one change per domain over
// the union of their scopes. A merged change describes several objects, so it
// keeps the first change's source and type but no object identity.
func mergeByDomain(changes []doorbell.Change) []doorbell.Change {
	scopes := map[string][]string{}
	first := map[string]doorbell.Change{}
	var order []string
	for _, change := range changes {
		if _, seen := first[change.Domain]; !seen {
			first[change.Domain] = change
			order = append(order, change.Domain)
		}
		explicit, _ := change.Target.ExplicitScopes()
		scopes[change.Domain] = append(scopes[change.Domain], explicit...)
	}
	sort.Strings(order)
	merged := make([]doorbell.Change, 0, len(order))
	for _, domainName := range order {
		change := first[domainName]
		merged = append(merged, doorbell.Change{
			Domain: domainName,
			Source: change.Source,
			Target: doorbell.Scopes(scopes[domainName]...),
			Type:   change.Type,
		})
	}
	return merged
}

// rowPublication rings a maintained store's domain after one of its ingest
// sinks applies a change: the scopes the row left as well as the ones it
// entered, plus any domain whose serve-time join reads the same source. A zero
// publication (no bell) rings nothing, for store-maintenance unit tests.
type rowPublication[T any] struct {
	bell   doorbell.Bell
	domain string
	meta   ClusterMeta
	scopes func(row T) []string
	// derived maps one row to other domains' changes; derivedDomains lists
	// those domains for a relist that redefines the whole kind.
	derived        func(row T) []doorbell.Change
	derivedDomains []string
	// ref gives the row's identity when the change has no catalog half.
	ref func(row T) *resourcemodel.ResourceRef
}

// changes is the doorbell work for one applied change. before is nil for an
// add and after is nil for a delete.
func (p rowPublication[T]) changes(before, after *T, catalog *objectcatalog.Summary, kind doorbell.MessageType) []doorbell.Change {
	if p.bell == nil {
		return nil
	}
	var scopes []string
	var derived []doorbell.Change
	for _, row := range []*T{before, after} {
		if row == nil {
			continue
		}
		scopes = append(scopes, p.scopes(*row)...)
		if p.derived != nil {
			derived = append(derived, p.derived(*row)...)
		}
	}
	current := after
	if current == nil {
		current = before
	}
	own := doorbell.Change{
		Domain: p.domain,
		Source: doorbell.SourceObject,
		Target: doorbell.Scopes(scopes...),
		Type:   kind,
		Ref:    p.changeRef(*current, catalog),
	}
	if catalog != nil {
		own.ResourceVersion = catalog.ResourceVersion
	}
	return append([]doorbell.Change{own}, mergeByDomain(derived)...)
}

func (p rowPublication[T]) changeRef(row T, catalog *objectcatalog.Summary) *resourcemodel.ResourceRef {
	if catalog != nil {
		ref := catalog.Ref
		if ref.ClusterID == "" {
			ref.ClusterID = p.meta.ClusterID
		}
		return &ref
	}
	if p.ref != nil {
		return p.ref(row)
	}
	return nil
}

// redefined rings every subscribed scope of the domain and its derived
// domains: a whole-kind relist may have changed any of them.
func (p rowPublication[T]) redefined() []doorbell.Change {
	if p.bell == nil {
		return nil
	}
	changes := []doorbell.Change{{Domain: p.domain, Source: doorbell.SourceObject, Target: doorbell.Subscribed()}}
	for _, domainName := range p.derivedDomains {
		changes = append(changes, doorbell.Change{Domain: domainName, Source: doorbell.SourceObject, Target: doorbell.Subscribed()})
	}
	return changes
}

func (p rowPublication[T]) ring(changes []doorbell.Change) {
	for _, change := range changes {
		p.bell.Ring(change)
	}
}

// relistBatch is one source registration's open relist.
type relistBatch struct {
	redefined bool
	pending   []doorbell.Change
}

func (b *relistBatch) add(changes []doorbell.Change) {
	b.pending = append(b.pending, changes...)
}

// namespacedRowPublication rings a row's namespace and All Namespaces.
func namespacedRowPublication[T any](m *typedMaintainedStore[T], domainName string, bell doorbell.Bell) rowPublication[T] {
	return rowPublication[T]{
		bell: bell, domain: domainName, meta: m.meta,
		scopes: func(row T) []string { return namespaceDoorbellScopes(m.adapter.Namespace(row)) },
	}
}

// clusterRowPublication rings the cluster scope.
func clusterRowPublication[T any](m *typedMaintainedStore[T], domainName string, bell doorbell.Bell) rowPublication[T] {
	return rowPublication[T]{
		bell: bell, domain: domainName, meta: m.meta,
		scopes: func(T) []string { return clusterDoorbellScopes() },
	}
}

// descriptorRowPublication is the publication for one descriptor kind. A kind
// the Identities view reads also rings that view.
func descriptorRowPublication[T any](m *typedMaintainedStore[T], domainName string, d streamspec.Descriptor, bell doorbell.Bell) rowPublication[T] {
	publication := namespacedRowPublication(m, domainName, bell)
	if d.ClusterScoped {
		publication = clusterRowPublication(m, domainName, bell)
	}
	if feedsIdentities(d.Group, d.Resource) {
		identities := doorbell.Change{Domain: clusterIdentitiesDomainName, Source: doorbell.SourceObject, Target: doorbell.Scopes(clusterDoorbellScopes()...)}
		publication.derived = func(T) []doorbell.Change { return []doorbell.Change{identities} }
		publication.derivedDomains = []string{clusterIdentitiesDomainName}
	}
	return publication
}

// feedsIdentities reports whether the Identities view reads the resource.
func feedsIdentities(group, resource string) bool {
	for _, source := range domainpermissions.CompositionByDomain()[clusterIdentitiesDomainName].Runtime {
		if source.Group == group && source.Resource == resource {
			return true
		}
	}
	return false
}

// storeHandlerFuncs applies one informer's deliveries to a store, then
// publishes each real change from the same handler, so a ring never reaches a
// reader before the store holds the change. client-go runs each handler on its
// own goroutine; a second handler on the informer could ring first. apply gets
// (nil, obj) for an add, (old, new) for an update, and (obj, nil) for a delete.
// Resync echoes still apply (idempotently) but publish nothing.
func storeHandlerFuncs(
	apply func(before, after interface{}),
	publish func(before, after metav1.Object, kind doorbell.MessageType),
) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			apply(nil, obj)
			publish(nil, asObject(obj), doorbell.MessageTypeAdded)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			apply(oldObj, newObj)
			if !InformerUpdateIsEcho(oldObj, newObj) {
				publish(asObject(oldObj), asObject(newObj), doorbell.MessageTypeModified)
			}
		},
		DeleteFunc: func(obj interface{}) {
			apply(obj, nil)
			publish(asObject(obj), nil, doorbell.MessageTypeDeleted)
		},
	}
}

func asObject(obj interface{}) metav1.Object {
	item, _ := maintainedUnwrap(obj).(metav1.Object)
	return item
}
