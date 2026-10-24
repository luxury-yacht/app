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

type objectMapRelationship struct {
	label           string
	defaultTracedBy string
}

var objectMapRelationships = map[string]objectMapRelationship{
	objectMapEdgeOwner: {
		label: "owns",
	},
	objectMapEdgeSelector: {
		label:           "selects",
		defaultTracedBy: "spec.selector",
	},
	objectMapEdgeEndpoint: {
		label: "has endpoints",
	},
	objectMapEdgeRoutes: {
		label: "routes to",
	},
	objectMapEdgeScales: {
		label:           "scales",
		defaultTracedBy: "spec.scaleTargetRef",
	},
	objectMapEdgeGrants: {
		label:           "grants",
		defaultTracedBy: "roleRef",
	},
	objectMapEdgeBinds: {
		label:           "binds",
		defaultTracedBy: "subjects",
	},
	objectMapEdgeAggregates: {
		label:           "aggregates",
		defaultTracedBy: "aggregationRule.clusterRoleSelectors",
	},
	objectMapEdgeUses: {
		label: "uses",
	},
	objectMapEdgeMounts: {
		label:           "mounts",
		defaultTracedBy: "volumes",
	},
	objectMapEdgeSchedules: {
		label:           "scheduled on",
		defaultTracedBy: "spec.nodeName",
	},
	objectMapEdgeVolumeBinding: {
		label:           "binds volume",
		defaultTracedBy: "spec.volumeName",
	},
	objectMapEdgeStorageClass: {
		label:           "uses class",
		defaultTracedBy: "spec.storageClassName",
	},
}
