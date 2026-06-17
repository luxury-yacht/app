// Package objectmapspec is the leaf that lets each kind declare its object-map
// relationship edges without importing the snapshot package. A kind's
// ObjectMapEdges returns LinkEdges (edges to a resourcemodel.ResourceLink target);
// the snapshot edge resolver looks up each LinkEdge's relationship metadata and
// resolves the link to a graph node. This keeps a kind's relationship logic in the
// kind's own package.
package objectmapspec

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Edge type identifiers. These are the single source for both the kind edge
// declarations and the snapshot relationship table keys.
const (
	EdgeOwner         = "owner"
	EdgeSelector      = "selector"
	EdgeEndpoint      = "endpoint"
	EdgeRoutes        = "routes"
	EdgeScales        = "scales"
	EdgeGrants        = "grants"
	EdgeBinds         = "binds"
	EdgeAggregates    = "aggregates"
	EdgeUses          = "uses"
	EdgeMounts        = "mounts"
	EdgeSchedules     = "schedules"
	EdgeVolumeBinding = "volume-binding"
	EdgeStorageClass  = "storage-class"
)

// LinkEdge is one relationship from a kind's object to a resourcemodel.ResourceLink
// target. Label and TracedBy are optional overrides; when empty the resolver uses
// the edge type's default label / traced-by from the relationship table.
type LinkEdge struct {
	Type     string
	Label    string
	TracedBy string
	Link     resourcemodel.ResourceLink
}

// RouteEdges is the shared Gateway-API route projection (HTTPRoute/GRPCRoute/
// TLSRoute): a "uses" edge to each parent and a "routes" edge to each backend.
func RouteEdges(facts resourcemodel.RouteCommonFacts) []LinkEdge {
	edges := make([]LinkEdge, 0, len(facts.ParentRefs)+len(facts.Backends))
	for _, parent := range facts.ParentRefs {
		edges = append(edges, LinkEdge{Type: EdgeUses, TracedBy: "spec.parentRefs", Link: parent})
	}
	for _, backend := range facts.Backends {
		edges = append(edges, LinkEdge{Type: EdgeRoutes, TracedBy: "spec.rules.backendRefs", Link: backend})
	}
	return edges
}
