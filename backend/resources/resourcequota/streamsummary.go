/*
 * backend/resources/resourcequota/streamsummary.go
 *
 * ResourceQuota's stream-summary builder, owned by the kind's package. Produces
 * the neutral streamrows.QuotaSummary row (the namespace-quotas domain is shared
 * by ResourceQuota, LimitRange, and PodDisruptionBudget). No snapshot import.
 */

package resourcequota

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the namespace-quotas row for one ResourceQuota.
func BuildStreamSummary(meta streamrows.ClusterMeta, quota *corev1.ResourceQuota) streamrows.QuotaSummary {
	if quota == nil {
		return streamrows.QuotaSummary{ClusterMeta: meta, Kind: "ResourceQuota"}
	}
	return streamrows.NewQuotaSummary(meta, quota, "ResourceQuota", DescribeSummary(BuildFacts(quota)))
}
