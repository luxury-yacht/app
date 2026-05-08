package resourcemodel

import (
	"fmt"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

func rbacResourceModel(
	clusterID, kind, resource string,
	scope ResourceScope,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return networkResourceModel(clusterID, rbacAPIGroup, "v1", kind, resource, scope, meta, status, facts)
}

func serviceAccountResourceModel(
	clusterID string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return networkResourceModel(clusterID, "", "v1", "ServiceAccount", "serviceaccounts", ResourceScopeNamespaced, meta, status, facts)
}

func copyPolicyRuleFacts(rules []rbacv1.PolicyRule) []PolicyRuleFacts {
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

func rbacRuleCountStatus(meta metav1.ObjectMeta, ruleCount int, aggregated bool) ResourceStatusPresentation {
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
	lifecycle := networkLifecycle(meta)
	if status, ok := deletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(label, state, "", "ready", signals, lifecycle)
}

func rbacBindingStatus(meta metav1.ObjectMeta, roleName string, subjectCount int) ResourceStatusPresentation {
	state := strconv.Itoa(subjectCount)
	if roleName == "" {
		roleName = "-"
	}
	label := fmt.Sprintf("Role: %s, Subjects: %d", roleName, subjectCount)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "roleRef.name", Status: roleName},
		{Type: StatusSignalResourceState, Name: "subjects.count", Status: state},
	}
	lifecycle := networkLifecycle(meta)
	if status, ok := deletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(label, state, "", "ready", signals, lifecycle)
}

func serviceAccountStatus(meta metav1.ObjectMeta, secretCount int) ResourceStatusPresentation {
	state := strconv.Itoa(secretCount)
	label := fmt.Sprintf("Secrets: %d", secretCount)
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "secrets.count",
		Status: state,
	}}
	lifecycle := networkLifecycle(meta)
	if status, ok := deletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(label, state, "", "ready", signals, lifecycle)
}

func rbacRoleBindingLink(clusterID string, binding rbacv1.RoleBinding) ResourceLink {
	return namespacedResourceLink(clusterID, rbacAPIGroup, "v1", "RoleBinding", "rolebindings", binding.Namespace, binding.Name, string(binding.UID))
}

func rbacClusterRoleBindingLink(clusterID string, binding rbacv1.ClusterRoleBinding) ResourceLink {
	return clusterResourceLink(clusterID, rbacAPIGroup, "v1", "ClusterRoleBinding", "clusterrolebindings", binding.Name, string(binding.UID))
}

func rbacRoleRefLink(clusterID, namespace string, ref rbacv1.RoleRef) ResourceLink {
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
		return clusterResourceLink(clusterID, rbacAPIGroup, "v1", "ClusterRole", "clusterroles", ref.Name, "")
	}
	return displayResourceLink(clusterID, ref.APIGroup, "", ref.Kind, "", namespace, ref.Name)
}

func rbacRoleRefMatches(ref rbacv1.RoleRef, kind, name string) bool {
	return ref.Kind == kind && ref.Name == name && (ref.APIGroup == "" || ref.APIGroup == rbacAPIGroup)
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

func rbacSubjectFactsList(clusterID, fallbackNamespace string, subjects []rbacv1.Subject) []SubjectFacts {
	if len(subjects) == 0 {
		return nil
	}
	facts := make([]SubjectFacts, 0, len(subjects))
	for _, subject := range subjects {
		facts = append(facts, rbacSubjectFacts(clusterID, fallbackNamespace, subject))
	}
	return facts
}

func secretLink(clusterID, namespace, name string) ResourceLink {
	return namespacedResourceLink(clusterID, "", "v1", "Secret", "secrets", namespace, name, "")
}

func roleBindingReferencesServiceAccount(binding rbacv1.RoleBinding, namespace, name string) bool {
	for _, subject := range binding.Subjects {
		if subject.Kind == "ServiceAccount" && subject.Name == name && (subject.Namespace == "" || subject.Namespace == namespace) {
			return true
		}
	}
	return false
}

func clusterRoleBindingReferencesServiceAccount(binding rbacv1.ClusterRoleBinding, namespace, name string) bool {
	for _, subject := range binding.Subjects {
		if subject.Kind == "ServiceAccount" && subject.Name == name && subject.Namespace == namespace {
			return true
		}
	}
	return false
}

func serviceAccountUsageLinks(clusterID string, sa *corev1.ServiceAccount, pods *corev1.PodList) []ResourceLink {
	if pods == nil {
		return nil
	}
	usedBy := make(map[string]ResourceLink)
	for _, pod := range pods.Items {
		if pod.Namespace != sa.Namespace {
			continue
		}
		if pod.Spec.ServiceAccountName == sa.Name || (pod.Spec.ServiceAccountName == "" && sa.Name == "default") {
			usedBy[pod.Namespace+"/"+pod.Name] = podResourceLink(clusterID, pod)
		}
	}
	if len(usedBy) == 0 {
		return nil
	}
	links := make([]ResourceLink, 0, len(usedBy))
	for _, link := range usedBy {
		links = append(links, link)
	}
	sortResourceLinksByObjectName(links)
	return links
}

func sortRBACLinks(links []ResourceLink) {
	sortResourceLinksByObjectName(links)
}
