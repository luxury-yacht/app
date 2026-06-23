package pods

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register pods's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place pods hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	// IngestOwned: the pod typed informer is never instantiated. A bespoke pod
	// reflector (snapshot.NewPodIngestProjector, wired via IngestManager.RegisterReflector)
	// projects each Pod at intake into a four-half Bundle, and every subsystem that
	// would otherwise read pods from the shared informer (the catalog, the object map,
	// the response-cache invalidator, the pods maintained store) reads the ingest
	// projections instead. Pods has no Stream descriptor, so the generic ingest loop
	// does not build it; the system wires the bespoke reflector explicitly.
	IngestOwned: true,
	Collector:   &ObjectMapNode,
	Edges:       ObjectMapEdges,
	Graph:       kindspec.ObjectMapGraph{DirectionalTraversal: true},
	PortForward: &kindspec.PortForwardTarget{ResolvePod: ForwardPodName},
}
