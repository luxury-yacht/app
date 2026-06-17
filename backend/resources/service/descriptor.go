package service

import "github.com/luxury-yacht/app/backend/refresh/kindspec"

// Descriptor(s) register service's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place service hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
	Graph:           kindspec.ObjectMapGraph{DirectionalTraversal: true},
	PortForward:     &kindspec.PortForwardTarget{ResolvePod: ForwardPodName, Reconnect: true, UsesServicePortSpec: true},
}
