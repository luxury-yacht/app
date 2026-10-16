// Package snapshot builds refresh-domain payloads, including the object-map
// relationship graph.
package snapshot

import "github.com/luxury-yacht/app/backend/kind/objectmapspec"

// The edge-type identifiers live in the objectmapspec leaf so kind packages can
// declare edges of these types; these aliases keep the snapshot-side names.
const (
	objectMapEdgeOwner         = objectmapspec.EdgeOwner
	objectMapEdgeSelector      = objectmapspec.EdgeSelector
	objectMapEdgeEndpoint      = objectmapspec.EdgeEndpoint
	objectMapEdgeRoutes        = objectmapspec.EdgeRoutes
	objectMapEdgeScales        = objectmapspec.EdgeScales
	objectMapEdgeGrants        = objectmapspec.EdgeGrants
	objectMapEdgeBinds         = objectmapspec.EdgeBinds
	objectMapEdgeAggregates    = objectmapspec.EdgeAggregates
	objectMapEdgeUses          = objectmapspec.EdgeUses
	objectMapEdgeMounts        = objectmapspec.EdgeMounts
	objectMapEdgeSchedules     = objectmapspec.EdgeSchedules
	objectMapEdgeVolumeBinding = objectmapspec.EdgeVolumeBinding
	objectMapEdgeStorageClass  = objectmapspec.EdgeStorageClass
)

type objectMapReverseTraversalPolicy int

const (
	objectMapReverseNever objectMapReverseTraversalPolicy = iota
	objectMapReverseAnyDepth
	objectMapReverseSeedOnly
	objectMapReverseDepthOne
)

type objectMapRelationship struct {
	label           string
	reversePolicy   objectMapReverseTraversalPolicy
	defaultTracedBy string
}

// canonicalObjectMapEdges drops edges that restate a relationship another edge
// in the same graph already shows, so each one is drawn once:
//   - an owner edge beside an endpoint edge for the same pair (an EndpointSlice
//     is owned by the Service whose endpoints it holds);
//   - a selector edge whose target the source also reaches through an endpoint
//     chain (source → slice → target). A selected target the endpoints leave
//     out keeps its selector edge, which shows that discrepancy.
//
// It runs after traversal, so it never changes which objects the map contains.
func canonicalObjectMapEdges(edges map[string]ObjectMapEdge) map[string]ObjectMapEdge {
	endpointTargets := objectMapEndpointTargets(edges)
	result := make(map[string]ObjectMapEdge, len(edges))
	for id, edge := range edges {
		if !isRedundantObjectMapEdge(edge, endpointTargets) {
			result[id] = edge
		}
	}
	return result
}

func objectMapEndpointTargets(edges map[string]ObjectMapEdge) map[string]map[string]struct{} {
	targets := make(map[string]map[string]struct{})
	for _, edge := range edges {
		if edge.Type != objectMapEdgeEndpoint {
			continue
		}
		if targets[edge.Source] == nil {
			targets[edge.Source] = make(map[string]struct{})
		}
		targets[edge.Source][edge.Target] = struct{}{}
	}
	return targets
}

func isRedundantObjectMapEdge(edge ObjectMapEdge, endpointTargets map[string]map[string]struct{}) bool {
	switch edge.Type {
	case objectMapEdgeOwner:
		_, parallel := endpointTargets[edge.Source][edge.Target]
		return parallel
	case objectMapEdgeSelector:
		for intermediate := range endpointTargets[edge.Source] {
			if _, chained := endpointTargets[intermediate][edge.Target]; chained {
				return true
			}
		}
	}
	return false
}

var objectMapRelationships = map[string]objectMapRelationship{
	objectMapEdgeOwner: {
		label:         "owns",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeSelector: {
		label:           "selects",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "spec.selector",
	},
	objectMapEdgeEndpoint: {
		label:         "has endpoints",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeRoutes: {
		label:         "routes to",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeScales: {
		label:           "scales",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "spec.scaleTargetRef",
	},
	objectMapEdgeGrants: {
		label:           "grants",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "roleRef",
	},
	objectMapEdgeBinds: {
		label:           "binds",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "subjects",
	},
	objectMapEdgeAggregates: {
		label:           "aggregates",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "aggregationRule.clusterRoleSelectors",
	},
	objectMapEdgeUses: {
		label:         "uses",
		reversePolicy: objectMapReverseSeedOnly,
	},
	objectMapEdgeMounts: {
		label:           "mounts",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "volumes",
	},
	objectMapEdgeSchedules: {
		label:           "scheduled on",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "spec.nodeName",
	},
	objectMapEdgeVolumeBinding: {
		label:           "binds volume",
		reversePolicy:   objectMapReverseDepthOne,
		defaultTracedBy: "spec.volumeName",
	},
	objectMapEdgeStorageClass: {
		label:           "uses class",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "spec.storageClassName",
	},
}
