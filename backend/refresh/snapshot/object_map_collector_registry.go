package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// objectMapCollectors is every kind read into the object map, derived from the
// single kind registry. Each kind declares how it is projected in its own
// package; the collector loop never names a kind. Every kind is read from its
// owned reflector's projected nodes.
var objectMapCollectors = objectMapCollectorsFromRegistry()

func objectMapCollectorsFromRegistry() []objectmapnode.Collector {
	out := make([]objectmapnode.Collector, 0, len(kindregistry.All))
	for _, d := range kindregistry.All {
		if d.Collector != nil {
			out = append(out, *d.Collector)
		}
	}
	return out
}

// objectMapCollectedKinds indexes every collector kind by group and kind, so a
// lookup that names an object by another served version finds the version the
// map collects it under.
var objectMapCollectedKinds = func() map[schema.GroupKind]resourcekind.Identity {
	kinds := make(map[schema.GroupKind]resourcekind.Identity, len(objectMapCollectors))
	for _, collector := range objectMapCollectors {
		kinds[collector.Identity.GVK().GroupKind()] = collector.Identity
	}
	return kinds
}()
