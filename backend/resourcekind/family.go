package resourcekind

import "strings"

const KarpenterFamily = "karpenter"

// FamilyForResource classifies discovered APIs without pinning their served
// versions or enumerating cloud-provider kinds. Scope still comes from discovery.
func FamilyForResource(group string, namespaced bool) string {
	if !namespaced && strings.HasPrefix(group, "karpenter.") {
		return KarpenterFamily
	}
	return ""
}
