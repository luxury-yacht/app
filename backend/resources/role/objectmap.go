package role

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// ObjectMapStatus projects the shared RBAC rule status into a map node.
func ObjectMapStatus(clusterID string, role rbacv1.Role) *objectmap.Status {
	status := resourcemodel.RBACRuleCountStatus(role.ObjectMeta, len(role.Rules), false)
	return objectmap.FromResourceModel(resourcemodel.KubernetesResourceModel(clusterID, Identity, role.ObjectMeta, status, resourcemodel.ResourceFacts{}))
}
