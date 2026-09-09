package rolebinding

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// ObjectMapStatus projects the shared RBAC binding status into a map node.
func ObjectMapStatus(clusterID string, binding rbacv1.RoleBinding) *objectmap.Status {
	status := resourcemodel.RBACBindingStatus(binding.ObjectMeta, binding.RoleRef.Name, len(binding.Subjects))
	return objectmap.FromResourceModel(resourcemodel.KubernetesResourceModel(clusterID, Identity, binding.ObjectMeta, status, resourcemodel.ResourceFacts{}))
}
