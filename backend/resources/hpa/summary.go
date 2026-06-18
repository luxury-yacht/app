/*
 * backend/resources/hpa/summary.go
 *
 * HorizontalPodAutoscaler detail-view summary + scale-target link projections,
 * co-located with the model. The snapshot streaming summary reads facts fields
 * directly (it builds its own AutoscalingSummary), so there is no streaming
 * DescribeSummary here.
 */

package hpa

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// detailsSummary renders the HPA detail-view summary line.
func detailsSummary(facts Facts) string {
	kind, name := scaleTargetKindName(facts.ScaleTarget)
	minReplicas := int32(1)
	if facts.MinReplicas != nil {
		minReplicas = *facts.MinReplicas
	}
	return fmt.Sprintf("Target: %s/%s, Replicas: %d/%d/%d", kind, name, minReplicas, facts.CurrentReplicas, facts.MaxReplicas)
}

func scaleTargetKindName(link resourcemodel.ResourceLink) (string, string) {
	if link.Ref != nil {
		return link.Ref.Kind, link.Ref.Name
	}
	if link.Display != nil {
		return link.Display.Kind, link.Display.Name
	}
	return "", ""
}

func scaleTargetAPIVersion(link resourcemodel.ResourceLink) string {
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
