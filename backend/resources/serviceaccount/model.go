/*
 * backend/resources/serviceaccount/model.go
 *
 * ServiceAccount resource model: the single definition of a ServiceAccount's
 * intrinsic fields + status presentation. Reverse links (pods/bindings) materialize
 * from the shared relationship index only when requested. Shared rbac helpers are
 * reused from resourcemodel (exported rbac base).
 */

package serviceaccount

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the ServiceAccount resource model. Facts are owned by
// this package (serviceaccount.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, sa *corev1.ServiceAccount, relationships *resourcemodel.ResourceRelationshipIndex, options ...resourcemodel.ResourceModelBuildOptions) resourcemodel.ResourceModel {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := BuildFacts(clusterID, sa, relationships, buildOptions)
	status := resourcemodel.ServiceAccountStatus(sa.ObjectMeta, len(facts.Secrets))
	return resourcemodel.ServiceAccountResourceModel(clusterID, sa.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the ServiceAccount facts. Reverse links materialize only when
// the MaterializeReverseLinks flag is set and a relationship index is supplied.
func BuildFacts(clusterID string, sa *corev1.ServiceAccount, relationships *resourcemodel.ResourceRelationshipIndex, options resourcemodel.ResourceModelBuildOptions) Facts {
	facts := Facts{
		AutomountToken: sa.AutomountServiceAccountToken,
	}
	for _, secret := range sa.Secrets {
		if secret.Name != "" {
			facts.Secrets = append(facts.Secrets, resourcemodel.SecretLink(clusterID, sa.Namespace, secret.Name))
		}
	}
	for _, secret := range sa.ImagePullSecrets {
		if secret.Name != "" {
			facts.ImagePullSecrets = append(facts.ImagePullSecrets, resourcemodel.SecretLink(clusterID, sa.Namespace, secret.Name))
		}
	}
	if options.Materialization.Has(resourcemodel.MaterializeReverseLinks) && relationships != nil {
		facts.UsedByPods = relationships.ServiceAccountUsedByPods(sa.Namespace, sa.Name)
		facts.RoleBindings = relationships.ServiceAccountRoleBindings(sa.Namespace, sa.Name)
		facts.ClusterRoleBindings = relationships.ServiceAccountClusterRoleBindings(sa.Namespace, sa.Name)
	}
	return facts
}
