/*
 * backend/resources/hpa/streamdescriptor.go
 *
 * HorizontalPodAutoscaler's resource-stream registry entry. One owned
 * autoscaling/v2 reflector feeds the namespace-autoscaling table, the workloads
 * table's HPA join (the ScaleTarget aggregate), and the object map.
 */

package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StreamDescriptor registers HPA for the namespace-autoscaling snapshot domain.
var StreamDescriptor = streamspec.Descriptor{
	Group:         Identity.Group,
	Version:       Identity.Version,
	Kind:          Identity.Kind,
	Resource:      Identity.Resource,
	Domain:        "namespace-autoscaling",
	ClusterScoped: !Identity.Namespaced,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*autoscalingv2.HorizontalPodAutoscaler))
	},
	AggregateRow: func(obj metav1.Object) any {
		return BuildScaleTarget(obj.(*autoscalingv2.HorizontalPodAutoscaler))
	},
}
