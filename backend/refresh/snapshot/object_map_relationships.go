// Package snapshot builds refresh-domain payloads, including the object-map
// relationship graph.
package snapshot

const (
	objectMapEdgeOwner         = "owner"
	objectMapEdgeSelector      = "selector"
	objectMapEdgeEndpoint      = "endpoint"
	objectMapEdgeRoutes        = "routes"
	objectMapEdgeScales        = "scales"
	objectMapEdgeGrants        = "grants"
	objectMapEdgeBinds         = "binds"
	objectMapEdgeAggregates    = "aggregates"
	objectMapEdgeUses          = "uses"
	objectMapEdgeMounts        = "mounts"
	objectMapEdgeSchedules     = "schedules"
	objectMapEdgeVolumeBinding = "volume-binding"
	objectMapEdgeStorageClass  = "storage-class"
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
