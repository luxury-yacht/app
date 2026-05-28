package objectcatalog

import "k8s.io/apimachinery/pkg/runtime/schema"

type collectionSourceKind string

const (
	collectionSourceSkip                  collectionSourceKind = "skip"
	collectionSourceSharedInformer        collectionSourceKind = "shared-informer"
	collectionSourceGatewayInformer       collectionSourceKind = "gateway-informer"
	collectionSourceAPIExtensionsInformer collectionSourceKind = "apiextensions-informer"
	collectionSourceDynamicList           collectionSourceKind = "dynamic-list"
)

type collectionSourcePlan struct {
	groupResource schema.GroupResource
	source        collectionSourceKind
	watchable     bool
	promotable    bool
}

func planCollectionSource(desc resourceDescriptor) collectionSourcePlan {
	return planCollectionSourceForGroupResource(desc.GVR.GroupResource())
}

func planCollectionSourceForGroupResource(gr schema.GroupResource) collectionSourcePlan {
	plan := collectionSourcePlan{
		groupResource: gr,
		source:        collectionSourceDynamicList,
		promotable:    true,
	}

	switch gr {
	case schema.GroupResource{Group: "", Resource: "endpoints"}:
		plan.source = collectionSourceSkip
		plan.promotable = false
	case schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}:
		plan.source = collectionSourceAPIExtensionsInformer
		plan.watchable = true
		plan.promotable = false
	default:
		if _, ok := sharedInformerListers[gr]; ok {
			plan.source = collectionSourceSharedInformer
			_, plan.watchable = watchInformerAccessor[gr]
			plan.promotable = false
			return plan
		}
		if _, ok := gatewayInformerListers[gr]; ok {
			plan.source = collectionSourceGatewayInformer
			plan.promotable = false
			return plan
		}
	}

	return plan
}
