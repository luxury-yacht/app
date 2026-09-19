/*
 * backend/resources/hpa/streamsummary.go
 *
 * HorizontalPodAutoscaler's stream-summary builder, owned by the kind's package.
 * Produces the neutral streamrows.AutoscalingSummary row from the v1 object. The
 * namespace-autoscaling domain streams HPA under v1. Returns a leaf type, so no
 * snapshot import.
 */

package hpa

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	"k8s.io/utils/ptr"
)

// BuildStreamSummary builds the namespace-autoscaling row for one HPA.
func BuildStreamSummary(meta streamrows.ClusterMeta, hpa *autoscalingv1.HorizontalPodAutoscaler) streamrows.AutoscalingSummary {
	if hpa == nil {
		return streamrows.AutoscalingSummary{Ref: streamrows.NewResourceRef(meta, Identity, nil)}
	}
	target := scaleTargetLink(meta.ClusterID, hpa.Namespace, hpa.Spec.ScaleTargetRef.APIVersion, hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)
	return streamrows.AutoscalingSummary{
		// The stream reads v1 objects, while navigation/details use the primary v2 API.
		Ref:              streamrows.NewResourceRef(meta, Identity, hpa),
		Metadata:         streamrows.NewResourceMetadata(hpa),
		Target:           streamTargetLabel(target),
		TargetAPIVersion: scaleTargetAPIVersion(target),
		Min:              ptr.Deref(hpa.Spec.MinReplicas, 1),
		Max:              hpa.Spec.MaxReplicas,
		Current:          hpa.Status.CurrentReplicas,
		Age:              streamrows.FormatAge(hpa.CreationTimestamp.Time),
		AgeTimestamp:     streamrows.CreationMillis(hpa),
	}
}

// streamTargetLabel is the "Kind/Name" target string shown in the table column.
func streamTargetLabel(link resourcemodel.ResourceLink) string {
	kind, name := scaleTargetKindName(link)
	return fmt.Sprintf("%s/%s", kind, name)
}
