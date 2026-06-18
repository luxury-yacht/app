/*
 * backend/resources/hpa/streamdescriptor.go
 *
 * HorizontalPodAutoscaler's resource-stream registry entry. Live streaming is
 * handled by a bespoke handler in resourcestream (registerAutoscalingStreams →
 * handleHPAEvent, which also refreshes the scale target's workload), so
 * CustomStreamHandler is set and registerDescriptorStreams skips it; this
 * descriptor exists so the namespace-autoscaling snapshot can loop the registry.
 */

package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers HPA for the namespace-autoscaling snapshot domain.
// The autoscaling/v1 informer feeds the summary builder (which takes a v1 HPA).
var StreamDescriptor = streamspec.Descriptor{
	Group:               IdentityV1.Group,
	Version:             IdentityV1.Version,
	Kind:                IdentityV1.Kind,
	Resource:            IdentityV1.Resource,
	Domain:              "namespace-autoscaling",
	ClusterScoped:       !IdentityV1.Namespaced,
	CustomStreamHandler: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*autoscalingv1.HorizontalPodAutoscaler))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Autoscaling().V1().HorizontalPodAutoscalers().Informer()
	},
}
