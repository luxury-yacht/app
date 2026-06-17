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
)

// informerListFunc returns objects for a namespace (or cluster-wide when empty/all).
type informerListFunc func(namespace string) ([]metav1.Object, error)

// sharedInformerGroupResources maps each catalog-cached built-in resource to the
// group-version-resource its shared informer is registered under. Membership marks
// a resource as shared-informer-backed (vs live/dynamic listed); the value is the
// GVR the generic lister/informer uses.
var sharedInformerGroupResources = map[schema.GroupResource]schema.GroupVersionResource{
	{Group: "", Resource: "pods"}:                                         {Group: "", Version: "v1", Resource: "pods"},
	{Group: "apps", Resource: "deployments"}:                              {Group: "apps", Version: "v1", Resource: "deployments"},
	{Group: "apps", Resource: "statefulsets"}:                             {Group: "apps", Version: "v1", Resource: "statefulsets"},
	{Group: "apps", Resource: "daemonsets"}:                               {Group: "apps", Version: "v1", Resource: "daemonsets"},
	{Group: "apps", Resource: "replicasets"}:                              {Group: "apps", Version: "v1", Resource: "replicasets"},
	{Group: "batch", Resource: "jobs"}:                                    {Group: "batch", Version: "v1", Resource: "jobs"},
	{Group: "batch", Resource: "cronjobs"}:                                {Group: "batch", Version: "v1", Resource: "cronjobs"},
	{Group: "", Resource: "services"}:                                     {Group: "", Version: "v1", Resource: "services"},
	{Group: "discovery.k8s.io", Resource: "endpointslices"}:               {Group: "discovery.k8s.io", Version: "v1", Resource: "endpointslices"},
	{Group: "", Resource: "configmaps"}:                                   {Group: "", Version: "v1", Resource: "configmaps"},
	{Group: "", Resource: "secrets"}:                                      {Group: "", Version: "v1", Resource: "secrets"},
	{Group: "", Resource: "persistentvolumeclaims"}:                       {Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
	{Group: "", Resource: "resourcequotas"}:                               {Group: "", Version: "v1", Resource: "resourcequotas"},
	{Group: "", Resource: "limitranges"}:                                  {Group: "", Version: "v1", Resource: "limitranges"},
	{Group: "networking.k8s.io", Resource: "ingresses"}:                   {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
	{Group: "networking.k8s.io", Resource: "networkpolicies"}:             {Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"},
	{Group: "autoscaling", Resource: "horizontalpodautoscalers"}:          {Group: "autoscaling", Version: "v1", Resource: "horizontalpodautoscalers"},
	{Group: "rbac.authorization.k8s.io", Resource: "clusterroles"}:        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"},
	{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"}: {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"},
	{Group: "rbac.authorization.k8s.io", Resource: "roles"}:               {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"},
	{Group: "rbac.authorization.k8s.io", Resource: "rolebindings"}:        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"},
	{Group: "", Resource: "namespaces"}:                                   {Group: "", Version: "v1", Resource: "namespaces"},
	{Group: "", Resource: "nodes"}:                                        {Group: "", Version: "v1", Resource: "nodes"},
	{Group: "", Resource: "persistentvolumes"}:                            {Group: "", Version: "v1", Resource: "persistentvolumes"},
	{Group: "storage.k8s.io", Resource: "storageclasses"}:                 {Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"},
}

// gatewayInformerGroupResources is the same set for Gateway-API resources, read
// from the Gateway-API informer factory.
var gatewayInformerGroupResources = map[schema.GroupResource]schema.GroupVersionResource{
	{Group: "gateway.networking.k8s.io", Resource: "gatewayclasses"}:     {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gatewayclasses"},
	{Group: "gateway.networking.k8s.io", Resource: "gateways"}:           {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gateways"},
	{Group: "gateway.networking.k8s.io", Resource: "httproutes"}:         {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "httproutes"},
	{Group: "gateway.networking.k8s.io", Resource: "grpcroutes"}:         {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "grpcroutes"},
	{Group: "gateway.networking.k8s.io", Resource: "tlsroutes"}:          {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "tlsroutes"},
	{Group: "gateway.networking.k8s.io", Resource: "listenersets"}:       {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "listenersets"},
	{Group: "gateway.networking.k8s.io", Resource: "referencegrants"}:    {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "referencegrants"},
	{Group: "gateway.networking.k8s.io", Resource: "backendtlspolicies"}: {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "backendtlspolicies"},
}

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
