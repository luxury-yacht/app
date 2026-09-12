package resourcekind

import "strings"

const (
	KarpenterFamily = "karpenter"
	ArgoCDFamily    = "argocd"
)

// FamilyForResource classifies discovered APIs without pinning served versions.
// Argo products share a group, so Argo CD also requires an explicit kind match.
func FamilyForResource(group, kind string, namespaced bool) string {
	if !namespaced && strings.HasPrefix(group, "karpenter.") {
		return KarpenterFamily
	}
	if namespaced && group == "argoproj.io" {
		switch strings.ToLower(kind) {
		case "application", "applicationset", "appproject":
			return ArgoCDFamily
		}
	}
	return ""
}

func IsResourceFamily(family string) bool {
	return family == KarpenterFamily || family == ArgoCDFamily
}
