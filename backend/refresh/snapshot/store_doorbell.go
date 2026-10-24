package snapshot

import (
	"sort"

	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

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
