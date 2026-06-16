/*
 * backend/resources/rolebinding/streamsummary.go
 *
 * RoleBinding's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.RBACSummary row. Returns a leaf type, so no snapshot import.
 */

package rolebinding

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildStreamSummary builds the namespace-rbac row for one RoleBinding.
func BuildStreamSummary(meta streamrows.ClusterMeta, binding *rbacv1.RoleBinding) streamrows.RBACSummary {
	if binding == nil {
		return streamrows.RBACSummary{ClusterMeta: meta, Kind: "RoleBinding"}
	}
	details := DescribeSummary(BuildFacts(meta.ClusterID, binding))
	return streamrows.NewRBACSummary(meta, binding, "RoleBinding", details)
}
