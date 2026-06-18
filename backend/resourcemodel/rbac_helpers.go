package resourcemodel

import (
	"fmt"
	"strconv"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

func RBACResourceModel(
	clusterID, kind, resource string,
	scope ResourceScope,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return NetworkResourceModel(clusterID, rbacAPIGroup, "v1", kind, resource, scope, meta, status, facts)
}

func ServiceAccountResourceModel(
	clusterID string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return NetworkResourceModel(clusterID, "", "v1", "ServiceAccount", "serviceaccounts", ResourceScopeNamespaced, meta, status, facts)
}

func CopyPolicyRuleFacts(rules []rbacv1.PolicyRule) []PolicyRuleFacts {
	if len(rules) == 0 {
		return nil
	}
	facts := make([]PolicyRuleFacts, 0, len(rules))
	for _, rule := range rules {
		facts = append(facts, PolicyRuleFacts{
			APIGroups:       append([]string(nil), rule.APIGroups...),
			Resources:       append([]string(nil), rule.Resources...),
			ResourceNames:   append([]string(nil), rule.ResourceNames...),
			Verbs:           append([]string(nil), rule.Verbs...),
			NonResourceURLs: append([]string(nil), rule.NonResourceURLs...),
		})
	}
	return facts
}

func RBACRuleCountStatus(meta metav1.ObjectMeta, ruleCount int, aggregated bool) ResourceStatusPresentation {
	state := strconv.Itoa(ruleCount)
	label := fmt.Sprintf("Rules: %d", ruleCount)
	if aggregated {
		label += " (aggregated)"
	}
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "rules.count",
		Status: state,
	}}
	lifecycle := NetworkLifecycle(meta)
	if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return NetworkSourceStatus(label, state, "", "ready", signals, lifecycle)
}

func RBACBindingStatus(meta metav1.ObjectMeta, roleName string, subjectCount int) ResourceStatusPresentation {
	state := strconv.Itoa(subjectCount)
	if roleName == "" {
		roleName = "-"
	}
	label := fmt.Sprintf("Role: %s, Subjects: %d", roleName, subjectCount)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "roleRef.name", Status: roleName},
		{Type: StatusSignalResourceState, Name: "subjects.count", Status: state},
	}
	lifecycle := NetworkLifecycle(meta)
	if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return NetworkSourceStatus(label, state, "", "ready", signals, lifecycle)
}

func ServiceAccountStatus(meta metav1.ObjectMeta, secretCount int) ResourceStatusPresentation {
	state := strconv.Itoa(secretCount)
	label := fmt.Sprintf("Secrets: %d", secretCount)
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "secrets.count",
		Status: state,
	}}
	lifecycle := NetworkLifecycle(meta)
	if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return NetworkSourceStatus(label, state, "", "ready", signals, lifecycle)
}

func rbacRoleBindingLink(clusterID string, binding rbacv1.RoleBinding) ResourceLink {
	return namespacedResourceLink(clusterID, rbacAPIGroup, "v1", "RoleBinding", "rolebindings", binding.Namespace, binding.Name, string(binding.UID))
}

func rbacClusterRoleBindingLink(clusterID string, binding rbacv1.ClusterRoleBinding) ResourceLink {
	return ClusterResourceLink(clusterID, rbacAPIGroup, "v1", "ClusterRoleBinding", "clusterrolebindings", binding.Name, string(binding.UID))
}

func RBACRoleRefLink(clusterID, namespace string, ref rbacv1.RoleRef) ResourceLink {
	if ref.APIGroup != rbacAPIGroup {
		return displayResourceLink(clusterID, ref.APIGroup, "", ref.Kind, "", namespace, ref.Name)
	}
	switch ref.Kind {
	case "Role":
		if ref.Name == "" {
			break
		}
		return namespacedResourceLink(clusterID, rbacAPIGroup, "v1", "Role", "roles", namespace, ref.Name, "")
	case "ClusterRole":
		if ref.Name == "" {
			break
		}
		return ClusterResourceLink(clusterID, rbacAPIGroup, "v1", "ClusterRole", "clusterroles", ref.Name, "")
	}
	return displayResourceLink(clusterID, ref.APIGroup, "", ref.Kind, "", namespace, ref.Name)
}

func rbacSubjectFacts(clusterID, fallbackNamespace string, subject rbacv1.Subject) SubjectFacts {
	facts := SubjectFacts{
		Kind:      subject.Kind,
		APIGroup:  subject.APIGroup,
		Name:      subject.Name,
		Namespace: subject.Namespace,
	}

	switch subject.Kind {
	case "ServiceAccount":
		namespace := subject.Namespace
		if namespace == "" {
			namespace = fallbackNamespace
		}
		if namespace != "" && subject.Name != "" {
			link := namespacedResourceLink(clusterID, "", "v1", "ServiceAccount", "serviceaccounts", namespace, subject.Name, "")
			facts.Link = &link
		}
	case "User", "Group":
		if subject.Name != "" {
			link := displayResourceLink(clusterID, subject.APIGroup, "", subject.Kind, "", subject.Namespace, subject.Name)
			facts.Link = &link
		}
	}

	return facts
}

func RBACSubjectFactsList(clusterID, fallbackNamespace string, subjects []rbacv1.Subject) []SubjectFacts {
	if len(subjects) == 0 {
		return nil
	}
	facts := make([]SubjectFacts, 0, len(subjects))
	for _, subject := range subjects {
		facts = append(facts, rbacSubjectFacts(clusterID, fallbackNamespace, subject))
	}
	return facts
}

func SecretLink(clusterID, namespace, name string) ResourceLink {
	return namespacedResourceLink(clusterID, "", "v1", "Secret", "secrets", namespace, name, "")
}
