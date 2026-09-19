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
