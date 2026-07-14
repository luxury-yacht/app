/*
 * backend/resources/resourcequota/streamdescriptor.go
 *
 * ResourceQuota's resource-stream registry entry.
 */

package resourcequota

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers ResourceQuota for resource streaming (namespace-quotas).
var StreamDescriptor = streamspec.Descriptor{
	Group:    Identity.Group,
	Version:  Identity.Version,
	Kind:     Identity.Kind,
	Resource: Identity.Resource,
	Domain:   "namespace-quotas",
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*corev1.ResourceQuota))
	},
	AggregateRow: func(obj metav1.Object) any {
		return BuildAggregate(obj.(*corev1.ResourceQuota))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Core().V1().ResourceQuotas().Informer()
	},
}
