package replicaset

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register replicaset's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place replicaset hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
	Graph:           kindspec.ObjectMapGraph{ScalableWorkload: true},
	Workload:        &kindspec.WorkloadOperations{Scale: workloadScale, CurrentReplicas: workloadCurrentReplicas},
	Actions:         kindspec.ObjectActions{Aliases: []string{"replicaset"}},
}
