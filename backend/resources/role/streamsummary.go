/*
 * backend/resources/role/streamsummary.go
 *
 * Role's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.RBACSummary row so the snapshot namespace-rbac domain can
 * dispatch to it from the registry. Returns a leaf type, so no snapshot import.
 */

package role

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildStreamSummary builds the namespace-rbac row for one Role.
func BuildStreamSummary(meta streamrows.ClusterMeta, r *rbacv1.Role) streamrows.RBACSummary {
	if r == nil {
		return streamrows.RBACSummary{}
	}
	details := DescribeSummary(BuildFacts(r, nil, resourcemodel.ResourceModelBuildOptions{}))
	return streamrows.NewRBACSummary(meta, Identity, r, details)
}
