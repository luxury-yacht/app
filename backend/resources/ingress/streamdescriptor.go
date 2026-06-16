/*
 * backend/resources/ingress/streamdescriptor.go
 *
 * Ingress's resource-stream registry entry.
 */

package ingress

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers Ingress for resource streaming (namespace-network).
var StreamDescriptor = streamspec.Descriptor{
	Group:    "networking.k8s.io",
	Version:  "v1",
	Kind:     "Ingress",
	Resource: "ingresses",
	Domain:   "namespace-network",
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*networkingv1.Ingress))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Networking().V1().Ingresses().Informer()
	},
}
