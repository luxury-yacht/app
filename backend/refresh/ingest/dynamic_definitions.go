package ingest

import (
	"maps"
	"sync"
	"sync/atomic"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

// dynamicDefinitions is the CRD input to the dynamic custom-resource sources.
// The CRD store's sink publishes each definition into current synchronously,
// under that store's write lock, so admission and discovery always read the
// latest definition, and a deleted one is gone before any queued work runs.
// Admission lifecycle work (permission reviews, reflector start and stop) runs
// on the lifecycle worker, never under the store lock, which keeps
// IngestManager.mu a leaf lock.
type dynamicDefinitions struct {
	// current maps CRD name to its definition. It is replaced whole on every
	// change (copy-on-write), so readers never lock.
	current   atomic.Pointer[map[string]apiextensions.Definition]
	project   func(DynamicCatalogSpec) CatalogProjector
	lifecycle *AsyncBundleSink
	mu        sync.Mutex
	preferred map[schema.GroupResource]string
}

func (d *dynamicDefinitions) lookup(name string) (apiextensions.Definition, bool) {
	definition, ok := (*d.current.Load())[name]
	return definition, ok
}

// SetCustomResourceDefinitions feeds the dynamic custom-resource sources from
// the CRD ingest store. Call it before Start. Projectors belong to the cluster
// generation and must not retain a catalog consumer. It reports false when no
// CRD store exists.
func (m *IngestManager) SetCustomResourceDefinitions(project func(DynamicCatalogSpec) CatalogProjector) bool {
	if project == nil {
		return false
	}
	m.mu.Lock()
	crds := m.entries[apiextensions.Identity.GVR()]
	if m.runDone != nil || m.stopped || crds == nil || m.definitions != nil {
		m.mu.Unlock()
		return false
	}
	definitions := &dynamicDefinitions{project: project, preferred: make(map[schema.GroupResource]string)}
	definitions.current.Store(&map[string]apiextensions.Definition{})
	definitions.lifecycle = NewAsyncBundleSink(definitionLifecycle{manager: m, definitions: definitions})
	m.definitions = definitions
	m.mu.Unlock()
	// The store lock is taken only after m.mu is released: m.mu is a leaf lock.
	crds.store.AddBundleSink(definitionPublisher{definitions: definitions})
	return true
}

// startDynamicDefinitions replays every published definition onto the
// lifecycle worker. Events queued before Start found no running manager and
// admitted nothing; the replay follows them in order.
func (m *IngestManager) startDynamicDefinitions() {
	m.mu.Lock()
	definitions := m.definitions
	m.mu.Unlock()
	if definitions == nil {
		return
	}
	for _, definition := range *definitions.current.Load() {
		definitions.lifecycle.UpsertBundle(Bundle{Aggregate: definition})
	}
}

// definitionPublisher is the CRD store's sink. It publishes the definitions
// table and queues lifecycle work; it never takes m.mu or definitions.mu.
type definitionPublisher struct {
	definitions *dynamicDefinitions
}

var (
	_ BundleReplacer = definitionPublisher{}
	_ BundleSeeder   = definitionPublisher{}
)

func (p definitionPublisher) UpsertBundle(bundle Bundle) {
	definition, ok := bundle.Aggregate.(apiextensions.Definition)
	if !ok {
		return
	}
	previous := p.publish(func(table map[string]apiextensions.Definition) { table[definition.Name] = definition })
	if old, existed := previous[definition.Name]; existed && old.UID != definition.UID {
		p.definitions.lifecycle.DeleteBundle(Bundle{Aggregate: old})
	}
	p.definitions.lifecycle.UpsertBundle(Bundle{Aggregate: definition})
}

func (p definitionPublisher) DeleteBundle(bundle Bundle) {
	definition, ok := bundle.Aggregate.(apiextensions.Definition)
	if !ok {
		return
	}
	p.publish(func(table map[string]apiextensions.Definition) { delete(table, definition.Name) })
	p.definitions.lifecycle.DeleteBundle(Bundle{Aggregate: definition})
}

// ReplaceBundles publishes a relist's complete set. A relist sends no
// per-definition deletes, so the previous table is diffed against it: a
// vanished definition, or one replaced by a new incarnation, is retired by its
// old UID before the remaining definitions are reconciled.
func (p definitionPublisher) ReplaceBundles(bundles []Bundle) {
	next := make(map[string]apiextensions.Definition, len(bundles))
	for _, bundle := range bundles {
		if definition, ok := bundle.Aggregate.(apiextensions.Definition); ok {
			next[definition.Name] = definition
		}
	}
	previous := *p.definitions.current.Swap(&next)
	for name, old := range previous {
		if current, kept := next[name]; !kept || current.UID != old.UID {
			p.definitions.lifecycle.DeleteBundle(Bundle{Aggregate: old})
		}
	}
	for _, definition := range next {
		p.definitions.lifecycle.UpsertBundle(Bundle{Aggregate: definition})
	}
}

// SeedBundles publishes the definitions restored from spill. The table is
// empty before a restore, so the seed only queues reconciles.
func (p definitionPublisher) SeedBundles(bundles []Bundle) {
	p.ReplaceBundles(bundles)
}

// publish applies change to a copy of the table, swaps it in, and returns the
// table it replaced. Only the CRD store's write lock calls it, so swaps never
// race.
func (p definitionPublisher) publish(change func(map[string]apiextensions.Definition)) map[string]apiextensions.Definition {
	previous := *p.definitions.current.Load()
	next := maps.Clone(previous)
	change(next)
	p.definitions.current.Store(&next)
	return previous
}

// definitionLifecycle runs on the ordered lifecycle worker. An upsert
// reconciles the definition's current published state, never the event's
// copy, so a delayed event cannot restore an older definition; a delete
// retires only the incarnation it names.
type definitionLifecycle struct {
	manager     *IngestManager
	definitions *dynamicDefinitions
}

func (l definitionLifecycle) UpsertBundle(bundle Bundle) {
	if definition, ok := bundle.Aggregate.(apiextensions.Definition); ok {
		l.manager.reconcileCachedDefinition(l.definitions, definition.Name, schema.GroupVersionResource{})
	}
}

func (l definitionLifecycle) DeleteBundle(bundle Bundle) {
	if definition, ok := bundle.Aggregate.(apiextensions.Definition); ok {
		l.manager.RemoveCustomResourceDefinition(definition)
	}
}

// ReconcileDiscoveredResource supplies discovery's preferred version and reports
// authoritative CRD classification. Missing CRD visibility retains the existing
// dynamic LIST/promotion policy; it is never interpreted as a CRD deletion.
func (m *IngestManager) ReconcileDiscoveredResource(gvr schema.GroupVersionResource) bool {
	m.mu.Lock()
	definitions := m.definitions
	m.mu.Unlock()
	if definitions == nil {
		return false
	}
	return m.reconcileCachedDefinition(definitions, gvr.Resource+"."+gvr.Group, gvr)
}

func (m *IngestManager) reconcileCachedDefinition(definitions *dynamicDefinitions, name string, discovered schema.GroupVersionResource) bool {
	definitions.mu.Lock()
	if discovered.Version != "" {
		definitions.preferred[discovered.GroupResource()] = discovered.Version
	}
	request, known := m.prepareDefinitionAdmission(definitions, name)
	definitions.mu.Unlock()
	if request != nil {
		m.completeDynamicAdmission(request, definitions.project(request.spec))
	}
	return known
}

// Reserve admission while serializing definition selection, then release that
// lock before any permission I/O. Newer definitions supersede the reservation.
func (m *IngestManager) prepareDefinitionAdmission(definitions *dynamicDefinitions, name string) (*dynamicAdmission, bool) {
	definition, exists := definitions.lookup(name)
	if !exists {
		return nil, false
	}
	gr := schema.GroupResource{Group: definition.Group, Resource: definition.Names.Plural}
	preferred := definitions.preferred[gr]
	if preferred == "" {
		// Discovery selects the initial served version. A speculative storage-version
		// watch would fetch everything again when the preferred version arrives.
		return nil, true
	}
	spec, valid := customResourceSpec(definition, preferred)
	if !valid {
		return nil, true
	}
	return m.beginDynamicAdmission(spec), true
}

// definitionCurrentLocked reports whether an admission still matches the
// published definition it was built from: a definition replaced or deleted
// since must not commit, even before its queued lifecycle event runs. A
// promoted source with no known definition has nothing to match. The table
// read is a lock-free load, so m.mu stays a leaf lock.
func (m *IngestManager) definitionCurrentLocked(spec DynamicCatalogSpec) bool {
	if spec.DefinitionUID == "" || m.definitions == nil {
		return true
	}
	definition, ok := m.definitions.lookup(spec.GVR.Resource + "." + spec.GVR.Group)
	if !ok || definition.UID != spec.DefinitionUID {
		return false
	}
	current, valid := customResourceSpec(definition, spec.GVR.Version)
	return valid && current == spec
}
