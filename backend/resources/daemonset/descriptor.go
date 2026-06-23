package daemonset

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register daemonset's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place daemonset hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	IngestOwned:     true,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
	Workload:        &kindspec.WorkloadOperations{Restart: workloadRestart, RevisionHistory: revisionHistory, ApplyPodTemplate: applyPodTemplate},
	PortForward:     &kindspec.PortForwardTarget{ResolvePod: ForwardPodName, Reconnect: true},
}
