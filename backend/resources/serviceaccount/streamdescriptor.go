/*
 * backend/resources/serviceaccount/streamdescriptor.go
 *
 * ServiceAccount's resource-stream registry entry.
 */

package serviceaccount

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers ServiceAccount for resource streaming (namespace-rbac).
var StreamDescriptor = streamspec.Descriptor{
	Group:    "",
	Version:  "v1",
	Kind:     "ServiceAccount",
	Resource: "serviceaccounts",
	Domain:   "namespace-rbac",
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*corev1.ServiceAccount))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Core().V1().ServiceAccounts().Informer()
	},
}
