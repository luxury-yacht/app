package endpointslice

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register endpointslice's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place endpointslice hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	// IngestOwned: the EndpointSlice typed informer is never instantiated. EndpointSlice
	// has no Stream descriptor because it is BOTH its own namespace-network table row AND
	// the join input for Service rows; the system wires a bespoke EndpointSlice reflector
	// (snapshot.NewEndpointSliceIngestProjector) projecting the NetworkSummary table row at
	// intake. The namespace-network serve path reads its rows as a table source and re-joins
	// endpoint counts onto Service rows from the same store.
	IngestOwned: true,
	Collector:   &ObjectMapNode,
	Edges:       ObjectMapEdges,
	Binding:     &DetailBinding,
	Graph:       kindspec.ObjectMapGraph{DirectionalTraversal: true},
}
