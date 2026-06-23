package service

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register service's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place service hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	// IngestOwned: the Service typed informer is never instantiated. Service has no
	// Stream descriptor (its namespace-network row is built joined with the Service's
	// correlated EndpointSlices, which the per-object StreamRow cannot carry), so the
	// generic ingest loop does not build it; the system wires a bespoke Service
	// reflector (snapshot.NewServiceIngestProjector) that projects the OWN-fields
	// NetworkSummary at intake. The serve path re-joins endpoint counts from the
	// projected EndpointSlice store, exactly as the workload kinds re-join pods.
	IngestOwned: true,
	Collector:   &ObjectMapNode,
	Edges:       ObjectMapEdges,
	Binding:     &DetailBinding,
	Graph:       kindspec.ObjectMapGraph{DirectionalTraversal: true},
	PortForward: &kindspec.PortForwardTarget{ResolvePod: ForwardPodName, Reconnect: true, UsesServicePortSpec: true},
}
