/*
 * backend/resources/serviceaccount/streamsummary.go
 *
 * ServiceAccount's stream-summary builder, owned by the kind's package. Produces
 * the neutral streamrows.RBACSummary row. Returns a leaf type, so no snapshot
 * import.
 */

package serviceaccount

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the namespace-rbac row for one ServiceAccount.
func BuildStreamSummary(meta streamrows.ClusterMeta, sa *corev1.ServiceAccount) streamrows.RBACSummary {
	if sa == nil {
		return streamrows.RBACSummary{ClusterMeta: meta, Kind: "ServiceAccount"}
	}
	details := DescribeSummary(BuildFacts(meta.ClusterID, sa, nil, resourcemodel.ResourceModelBuildOptions{}))
	return streamrows.NewRBACSummary(meta, sa, "ServiceAccount", details)
}
