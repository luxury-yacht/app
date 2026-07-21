/*
 * backend/resources/hpa/streamsummary.go
 *
 * HorizontalPodAutoscaler's stream-summary builder, owned by the kind's package.
 * Produces the neutral streamrows.AutoscalingSummary row from the v1 facts. The
 * namespace-autoscaling domain streams HPA under v1. Returns a leaf type, so no
 * snapshot import.
 */

package hpa

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
)

// BuildStreamSummary builds the namespace-autoscaling row for one HPA.
func BuildStreamSummary(meta streamrows.ClusterMeta, hpa *autoscalingv1.HorizontalPodAutoscaler) streamrows.AutoscalingSummary {
	if hpa == nil {
		return streamrows.AutoscalingSummary{ClusterMeta: meta, Kind: "HorizontalPodAutoscaler"}
	}
	facts := BuildV1Facts(meta.ClusterID, hpa)
	return streamrows.AutoscalingSummary{
		ClusterMeta: meta,
		// The stream reads v1 objects, while navigation/details use the primary v2 API.
		Ref:              streamrows.NewResourceRef(meta, Identity, hpa),
		Kind:             "HorizontalPodAutoscaler",
		Name:             hpa.Name,
		Namespace:        hpa.Namespace,
		Target:           streamTargetLabel(facts.ScaleTarget),
		TargetAPIVersion: streamTargetAPIVersion(facts.ScaleTarget),
		Min:              streamMinReplicas(facts),
		Max:              facts.MaxReplicas,
		Current:          facts.CurrentReplicas,
		Age:              streamrows.FormatAge(hpa.CreationTimestamp.Time),
		AgeTimestamp:     streamrows.CreationMillis(hpa),
	}
}

// streamTargetLabel is the "Kind/Name" target string shown in the table column.
func streamTargetLabel(link resourcemodel.ResourceLink) string {
	kind, name := "", ""
	if link.Ref != nil {
		kind, name = link.Ref.Kind, link.Ref.Name
	} else if link.Display != nil {
		kind, name = link.Display.Kind, link.Display.Name
	}
	return fmt.Sprintf("%s/%s", kind, name)
}

// streamMinReplicas returns the configured minimum, defaulting to 1 when unset.
func streamMinReplicas(facts Facts) int32 {
	if facts.MinReplicas == nil {
		return 1
	}
	return *facts.MinReplicas
}

// streamTargetAPIVersion is the scale target's apiVersion (group/version).
func streamTargetAPIVersion(link resourcemodel.ResourceLink) string {
	if link.Ref != nil {
		if link.Ref.Group == "" {
			return link.Ref.Version
		}
		return link.Ref.Group + "/" + link.Ref.Version
	}
	if link.Display != nil {
		if link.Display.Group == "" {
			return link.Display.Version
		}
		return link.Display.Group + "/" + link.Display.Version
	}
	return ""
}
