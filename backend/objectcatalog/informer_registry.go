/*
 * backend/objectcatalog/informer_registry.go
 *
 * Which built-in resources the catalog reads from the shared informer cache, and a
 * single generic lister that lists any of them via the factory's ForResource — so
 * no per-kind lister is wired here.
 */

package objectcatalog

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/refresh/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/kindspec"
)

// informerListFunc returns objects for a namespace (or cluster-wide when empty/all).
type informerListFunc func(namespace string) ([]metav1.Object, error)

// catalogGroupResources builds the GroupResource→GVR map for every registry kind
// with the given catalog source. Membership marks a resource as served by that
// informer factory (vs live/dynamic listed); the value is the GVR the generic
// lister/informer uses. The catalog never lists kinds itself — it derives them
// from the single kind registry.
func catalogGroupResources(source kindspec.CatalogSource) map[schema.GroupResource]schema.GroupVersionResource {
	out := map[schema.GroupResource]schema.GroupVersionResource{}
	for _, d := range kindregistry.All {
		if d.CatalogSource != source {
			continue
		}
		gvr := schema.GroupVersionResource{Group: d.Identity.Group, Version: d.Identity.Version, Resource: d.Identity.Resource}
		out[gvr.GroupResource()] = gvr
	}
	return out
}

// sharedInformerGroupResources is every registry kind read from the core shared
// informer factory; gatewayInformerGroupResources is the Gateway-API equivalent.
var (
	sharedInformerGroupResources  = catalogGroupResources(kindspec.CatalogShared)
	gatewayInformerGroupResources = catalogGroupResources(kindspec.CatalogGateway)
)

// sharedInformerLister lists a shared-informer-backed resource generically through
// the factory's ForResource, so adding a resource is one map entry, not a lister.
func sharedInformerLister(factory informers.SharedInformerFactory, gvr schema.GroupVersionResource) informerListFunc {
	generic, err := factory.ForResource(gvr)
	if err != nil {
		return nil
	}
	return genericListerFunc(generic.Lister())
}

// gatewayInformerLister is sharedInformerLister for the Gateway-API factory.
func gatewayInformerLister(factory gatewayinformers.SharedInformerFactory, gvr schema.GroupVersionResource) informerListFunc {
	generic, err := factory.ForResource(gvr)
	if err != nil {
		return nil
	}
	return genericListerFunc(generic.Lister())
}

// genericListerFunc adapts a client-go GenericLister to the catalog's namespaced
// list signature. An empty namespace (cluster-scoped resources and the
// namespace-all case) lists everything; a specific namespace scopes the lister.
func genericListerFunc(lister cache.GenericLister) informerListFunc {
	return func(namespace string) ([]metav1.Object, error) {
		var objs []runtime.Object
		var err error
		if namespace == "" || namespace == metav1.NamespaceAll {
			objs, err = lister.List(labels.Everything())
		} else {
			objs, err = lister.ByNamespace(namespace).List(labels.Everything())
		}
		if err != nil {
			return nil, err
		}
		out := make([]metav1.Object, 0, len(objs))
		for _, obj := range objs {
			if metaObj, ok := obj.(metav1.Object); ok {
				out = append(out, metaObj)
			}
		}
		return out, nil
	}
}
