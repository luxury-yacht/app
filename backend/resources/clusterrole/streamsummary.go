/*
 * backend/resources/clusterrole/streamsummary.go
 *
 * ClusterRole's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.ClusterRBACEntry row (cluster-rbac domain). No snapshot import.
 */

package clusterrole

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildStreamSummary builds the cluster-rbac row for one ClusterRole.
func BuildStreamSummary(meta streamrows.ClusterMeta, role *rbacv1.ClusterRole) streamrows.ClusterRBACEntry {
	if role == nil {
		return streamrows.ClusterRBACEntry{ClusterMeta: meta, Kind: "ClusterRole"}
	}
	details := DescribeSummary(BuildFacts(role, nil, resourcemodel.ResourceModelBuildOptions{}))
	return streamrows.NewClusterRBACEntry(meta, role, "ClusterRole", details, "CR")
}
