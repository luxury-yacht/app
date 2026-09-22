package ingest

import (
	"sync"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
)

// Definitions reuse the permission-gated CRD informer. This is input to the
// ingest lifecycle, not another CRD or custom-resource watch.
type dynamicDefinitions struct {
	informer  cache.SharedIndexInformer
	project   func(DynamicCatalogSpec) CatalogProjector
	mu        sync.Mutex
	preferred map[schema.GroupResource]string
}

// SetCustomResourceDefinitions configures CRD intake before Start. Projectors
// belong to the cluster generation and must not retain a catalog consumer.
func (m *IngestManager) SetCustomResourceDefinitions(informer cache.SharedIndexInformer, project func(DynamicCatalogSpec) CatalogProjector) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runDone != nil || m.stopped || informer == nil || project == nil {
		return
	}
	m.definitions = &dynamicDefinitions{informer: informer, project: project, preferred: make(map[schema.GroupResource]string)}
}

func (m *IngestManager) startDynamicDefinitions() {
	m.mu.Lock()
	definitions := m.definitions
	m.mu.Unlock()
	if definitions == nil {
		return
	}
	registration, err := definitions.informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { m.definitionChanged(obj, false) },
		UpdateFunc: func(_, obj interface{}) { m.definitionChanged(obj, false) },
		DeleteFunc: func(obj interface{}) { m.definitionChanged(obj, true) },
	})
	if err != nil {
		return
	}
	m.mu.Lock()
	stopped := m.stopped
	if !stopped {
		m.definitionRegistration = registration
	}
	m.mu.Unlock()
	if stopped {
		_ = definitions.informer.RemoveEventHandler(registration)
	}
}

func (m *IngestManager) definitionChanged(obj interface{}, deleted bool) {
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		obj = tombstone.Obj
	}
	crd, ok := obj.(*apiextensionsv1.CustomResourceDefinition)
	if !ok {
		return
	}
	definitions := m.definitions
	if deleted {
		m.RemoveCustomResourceDefinition(crd)
		return
	}
	// Replay may lag the informer cache. Read its current definition after taking
	// reconciliation ownership so an older callback cannot restore an old UID.
	m.reconcileCachedDefinition(definitions, crd.Name, schema.GroupVersionResource{})
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
	obj, exists, err := definitions.informer.GetStore().GetByKey(name)
	if err != nil || !exists {
		return nil, false
	}
	crd, ok := obj.(*apiextensionsv1.CustomResourceDefinition)
	if !ok {
		return nil, false
	}
	gr := schema.GroupResource{Group: crd.Spec.Group, Resource: crd.Spec.Names.Plural}
	preferred := definitions.preferred[gr]
	if preferred == "" {
		// Discovery selects the initial served version. A speculative storage-version
		// watch would fetch everything again when the preferred version arrives.
		return nil, true
	}
	spec, valid := customResourceSpec(crd, preferred)
	if !valid {
		return nil, true
	}
	return m.beginDynamicAdmission(spec), true
}
