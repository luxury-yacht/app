package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// objectMapEdgeBuilders maps each kind to its relationship-edge builder, derived
// from the single kind registry. The edge resolver dispatches a record to its
// kind's builder by Kind; no per-kind edge logic lives in object_map.go for these
// kinds. Each kind declares its edges in its own package (resources/<kind>).
var objectMapEdgeBuilders = objectMapEdgeBuildersFromRegistry()

func objectMapEdgeBuildersFromRegistry() map[string]func(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	out := map[string]func(clusterID string, obj metav1.Object) []objectmapspec.Edge{}
	for _, d := range kindregistry.All {
		if d.Edges != nil {
			out[d.Identity.Kind] = d.Edges
		}
	}
	return out
}
