package resourcemodel

import (
	"fmt"
	"strconv"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

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

// RBACRuleSummary describes intrinsic rules independently of deletion status.
func RBACRuleSummary(ruleCount int, aggregated bool) string {
	label := fmt.Sprintf("Rules: %d", ruleCount)
	if aggregated {
		label += " (aggregated)"
	}
	return label
}

// RBACBindingSummary is the terse role/subject summary shared by lists and maps.
func RBACBindingSummary(roleName string, subjectCount int) string {
	if roleName == "" {
		roleName = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", roleName, subjectCount)
}

// ServiceAccountSummary describes named token secrets, excluding image-pull secrets.
func ServiceAccountSummary(secretCount int) string {
	return fmt.Sprintf("Secrets: %d", secretCount)
}

func RBACRuleCountStatus(meta metav1.ObjectMeta, ruleCount int, aggregated bool) ResourceStatusPresentation {
	state := strconv.Itoa(ruleCount)
	label := RBACRuleSummary(ruleCount, aggregated)
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "rules.count",
		Status: state,
	}}
	lifecycle := ObjectLifecycle(meta)
	if status, ok := DeletingObjectStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return ObjectSourceStatus(label, state, "", "", "ready", signals, lifecycle)
}

func RBACBindingStatus(meta metav1.ObjectMeta, roleName string, subjectCount int) ResourceStatusPresentation {
	state := strconv.Itoa(subjectCount)
	if roleName == "" {
		roleName = "-"
	}
	label := RBACBindingSummary(roleName, subjectCount)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "roleRef.name", Status: roleName},
		{Type: StatusSignalResourceState, Name: "subjects.count", Status: state},
	}
	lifecycle := ObjectLifecycle(meta)
	if status, ok := DeletingObjectStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return ObjectSourceStatus(label, state, "", "", "ready", signals, lifecycle)
}

func ServiceAccountStatus(meta metav1.ObjectMeta, secretCount int) ResourceStatusPresentation {
	state := strconv.Itoa(secretCount)
	label := ServiceAccountSummary(secretCount)
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "secrets.count",
		Status: state,
	}}
	lifecycle := ObjectLifecycle(meta)
	if status, ok := DeletingObjectStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return ObjectSourceStatus(label, state, "", "", "ready", signals, lifecycle)
}

func rbacRoleBindingLink(clusterID string, binding rbacv1.RoleBinding) ResourceLink {
	return NewNamespacedResourceLink(ResourceRef{ClusterID: clusterID, Group: rbacAPIGroup, Version: "v1", Kind: "RoleBinding", Resource: "rolebindings", Namespace: binding.Namespace, Name: binding.Name, UID: string(binding.UID)})
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
		return NewNamespacedResourceLink(ResourceRef{ClusterID: clusterID, Group: rbacAPIGroup, Version: "v1", Kind: "Role", Resource: "roles", Namespace: namespace, Name: ref.Name, UID: ""})
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
			link := NewNamespacedResourceLink(ResourceRef{ClusterID: clusterID, Group: "", Version: "v1", Kind: "ServiceAccount", Resource: "serviceaccounts", Namespace: namespace, Name: subject.Name, UID: ""})
			facts.Link = &link
		}
	case "User", "Group":
		if subject.Name != "" {
			link := displayResourceLink(clusterID, subject.APIGroup, "", subject.Kind, "", subject.Namespace, subject.Name)
			// Authentication subject names are opaque; trimming would merge
			// distinct principals when aggregating binding relationships.
			link.Display.Name = subject.Name
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
	return NewNamespacedResourceLink(ResourceRef{ClusterID: clusterID, Group: "", Version: "v1", Kind: "Secret", Resource: "secrets", Namespace: namespace, Name: name, UID: ""})
}
