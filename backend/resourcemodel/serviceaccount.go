package resourcemodel

import (
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
)

func BuildServiceAccountResourceModel(
	clusterID string,
	sa *corev1.ServiceAccount,
	pods *corev1.PodList,
	roleBindings *rbacv1.RoleBindingList,
	clusterRoleBindings *rbacv1.ClusterRoleBindingList,
) ResourceModel {
	facts := BuildServiceAccountFacts(clusterID, sa, pods, roleBindings, clusterRoleBindings)
	status := serviceAccountStatus(sa.ObjectMeta, len(facts.Secrets))
	return serviceAccountResourceModel(clusterID, sa.ObjectMeta, status, ResourceFacts{ServiceAccount: &facts})
}

func BuildServiceAccountFacts(
	clusterID string,
	sa *corev1.ServiceAccount,
	pods *corev1.PodList,
	roleBindings *rbacv1.RoleBindingList,
	clusterRoleBindings *rbacv1.ClusterRoleBindingList,
) ServiceAccountFacts {
	facts := ServiceAccountFacts{
		AutomountToken: sa.AutomountServiceAccountToken,
		UsedByPods:     serviceAccountUsageLinks(clusterID, sa, pods),
	}
	for _, secret := range sa.Secrets {
		if secret.Name != "" {
			facts.Secrets = append(facts.Secrets, secretLink(clusterID, sa.Namespace, secret.Name))
		}
	}
	for _, secret := range sa.ImagePullSecrets {
		if secret.Name != "" {
			facts.ImagePullSecrets = append(facts.ImagePullSecrets, secretLink(clusterID, sa.Namespace, secret.Name))
		}
	}
	if roleBindings != nil {
		for _, binding := range roleBindings.Items {
			if binding.Namespace != sa.Namespace {
				continue
			}
			if roleBindingReferencesServiceAccount(binding, sa.Namespace, sa.Name) {
				facts.RoleBindings = append(facts.RoleBindings, rbacRoleBindingLink(clusterID, binding))
			}
		}
		sortRBACLinks(facts.RoleBindings)
	}
	if clusterRoleBindings != nil {
		for _, binding := range clusterRoleBindings.Items {
			if clusterRoleBindingReferencesServiceAccount(binding, sa.Namespace, sa.Name) {
				facts.ClusterRoleBindings = append(facts.ClusterRoleBindings, rbacClusterRoleBindingLink(clusterID, binding))
			}
		}
		sortRBACLinks(facts.ClusterRoleBindings)
	}
	return facts
}
