package objectcatalog

import "k8s.io/apimachinery/pkg/runtime/schema"

type collectionSourceKind string

const (
	collectionSourceSkip        collectionSourceKind = "skip"
	collectionSourceDynamicList collectionSourceKind = "dynamic-list"
)

type collectionSourcePlan struct {
	groupResource schema.GroupResource
	source        collectionSourceKind
	promotable    bool
}

func planCollectionSource(desc Descriptor) collectionSourcePlan {
	return planCollectionSourceForGroupResource(desc.GVR().GroupResource())
}

func planCollectionSourceForGroupResource(gr schema.GroupResource) collectionSourcePlan {
	plan := collectionSourcePlan{
		groupResource: gr,
		source:        collectionSourceDynamicList,
		promotable:    true,
	}

	if gr == (schema.GroupResource{Group: "", Resource: "endpoints"}) {
		plan.source = collectionSourceSkip
		plan.promotable = false
	}

	return plan
}
