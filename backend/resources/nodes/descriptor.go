package nodes

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register nodes's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place nodes hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:      Identity,
	CatalogSource: kindspec.CatalogShared,
	// IngestOwned: the Node typed informer is never instantiated. Node has no Stream
	// descriptor (its table is the bespoke NodeSummary whose row joins per-node pod
	// aggregates + metrics, which the per-object StreamRow cannot carry), so the generic
	// ingest loop does not build it; the system wires a bespoke Node reflector
	// (snapshot.NewNodeIngestProjector) that projects the OWN-fields NodeSummary at intake.
	// The serve path re-joins pod aggregates + metrics from the already-cut pod store,
	// exactly as the workload kinds re-join pods. The catalog + object-map read the node's
	// projected halves through the generic IngestOwned facet.
	IngestOwned:     true,
	DetailCacheable: true,
	Collector:       &ObjectMapNode,
	Binding:         &DetailBinding,
	Graph:           kindspec.ObjectMapGraph{DirectionalTraversal: true},
}
