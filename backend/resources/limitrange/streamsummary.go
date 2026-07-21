/*
 * backend/resources/limitrange/streamsummary.go
 *
 * LimitRange's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.QuotaSummary row (namespace-quotas domain). No snapshot import.
 */

package limitrange

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the namespace-quotas row for one LimitRange.
func BuildStreamSummary(meta streamrows.ClusterMeta, limit *corev1.LimitRange) streamrows.QuotaSummary {
	if limit == nil {
		return streamrows.QuotaSummary{ClusterMeta: meta, Kind: "LimitRange"}
	}
	return streamrows.NewQuotaSummary(meta, Identity, limit, DescribeSummary(BuildFacts(limit)))
}
