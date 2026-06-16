/*
 * backend/resources/ingressclass/streamdescriptor.go
 *
 * IngressClass's resource-stream registry entry.
 */

package ingressclass

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers IngressClass for resource streaming (cluster-config).
var StreamDescriptor = streamspec.Descriptor{
	Group:         "networking.k8s.io",
	Version:       "v1",
	Kind:          "IngressClass",
	Resource:      "ingressclasses",
	Domain:        "cluster-config",
	ClusterScoped: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*networkingv1.IngressClass))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Networking().V1().IngressClasses().Informer()
	},
}
