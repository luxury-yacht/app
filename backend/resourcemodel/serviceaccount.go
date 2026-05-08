package resourcemodel

import (
	corev1 "k8s.io/api/core/v1"
)

func BuildServiceAccountResourceModel(
	clusterID string,
	sa *corev1.ServiceAccount,
	relationships *ResourceRelationshipIndex,
	options ...ResourceModelBuildOptions,
) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildServiceAccountFacts(clusterID, sa, relationships, buildOptions)
	status := serviceAccountStatus(sa.ObjectMeta, len(facts.Secrets))
	return serviceAccountResourceModel(clusterID, sa.ObjectMeta, status, ResourceFacts{ServiceAccount: &facts})
}

func BuildServiceAccountFacts(
	clusterID string,
	sa *corev1.ServiceAccount,
	relationships *ResourceRelationshipIndex,
	options ResourceModelBuildOptions,
) ServiceAccountFacts {
	facts := ServiceAccountFacts{
		AutomountToken: sa.AutomountServiceAccountToken,
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
	if options.Materialization.Has(MaterializeReverseLinks) && relationships != nil {
		facts.UsedByPods = relationships.ServiceAccountUsedByPods(sa.Namespace, sa.Name)
		facts.RoleBindings = relationships.ServiceAccountRoleBindings(sa.Namespace, sa.Name)
		facts.ClusterRoleBindings = relationships.ServiceAccountClusterRoleBindings(sa.Namespace, sa.Name)
	}
	return facts
}
