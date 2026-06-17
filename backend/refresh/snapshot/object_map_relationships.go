// Package snapshot builds refresh-domain payloads, including the object-map
// relationship graph.
package snapshot

import "github.com/luxury-yacht/app/backend/refresh/objectmapspec"

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
	typ             string
	label           string
	reversePolicy   objectMapReverseTraversalPolicy
	defaultTracedBy string
}

var objectMapRelationships = map[string]objectMapRelationship{
	objectMapEdgeOwner: {
		typ:           objectMapEdgeOwner,
		label:         "owns",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeSelector: {
		typ:             objectMapEdgeSelector,
		label:           "selects",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "spec.selector",
	},
	objectMapEdgeEndpoint: {
		typ:           objectMapEdgeEndpoint,
		label:         "has endpoints",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeRoutes: {
		typ:           objectMapEdgeRoutes,
		label:         "routes to",
		reversePolicy: objectMapReverseAnyDepth,
	},
	objectMapEdgeScales: {
		typ:             objectMapEdgeScales,
		label:           "scales",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "spec.scaleTargetRef",
	},
	objectMapEdgeGrants: {
		typ:             objectMapEdgeGrants,
		label:           "grants",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "roleRef",
	},
	objectMapEdgeBinds: {
		typ:             objectMapEdgeBinds,
		label:           "binds",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "subjects",
	},
	objectMapEdgeAggregates: {
		typ:             objectMapEdgeAggregates,
		label:           "aggregates",
		reversePolicy:   objectMapReverseAnyDepth,
		defaultTracedBy: "aggregationRule.clusterRoleSelectors",
	},
	objectMapEdgeUses: {
		typ:           objectMapEdgeUses,
		label:         "uses",
		reversePolicy: objectMapReverseSeedOnly,
	},
	objectMapEdgeMounts: {
		typ:             objectMapEdgeMounts,
		label:           "mounts",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "volumes",
	},
	objectMapEdgeSchedules: {
		typ:             objectMapEdgeSchedules,
		label:           "scheduled on",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "spec.nodeName",
	},
	objectMapEdgeVolumeBinding: {
		typ:             objectMapEdgeVolumeBinding,
		label:           "binds volume",
		reversePolicy:   objectMapReverseDepthOne,
		defaultTracedBy: "spec.volumeName",
	},
	objectMapEdgeStorageClass: {
		typ:             objectMapEdgeStorageClass,
		label:           "uses class",
		reversePolicy:   objectMapReverseSeedOnly,
		defaultTracedBy: "spec.storageClassName",
	},
}
