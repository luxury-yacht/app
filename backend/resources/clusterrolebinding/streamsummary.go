/*
 * backend/resources/clusterrolebinding/streamsummary.go
 *
 * ClusterRoleBinding's stream-summary builder, owned by the kind's package.
 * Produces the neutral streamrows.ClusterRBACEntry row (cluster-rbac). No snapshot
 * import.
 */

package clusterrolebinding

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildStreamSummary builds the cluster-rbac row for one ClusterRoleBinding.
func BuildStreamSummary(meta streamrows.ClusterMeta, binding *rbacv1.ClusterRoleBinding) streamrows.ClusterRBACEntry {
	if binding == nil {
		return streamrows.ClusterRBACEntry{}
	}
	details := DescribeSummary(BuildFacts(meta.ClusterID, binding))
	return streamrows.NewClusterRBACEntry(meta, Identity, binding, details, "CRB")
}
