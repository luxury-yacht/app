package snapshot

import (
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
)

// clusterDoorbellScopes is the scope a cluster-scoped table subscribes to.
func clusterDoorbellScopes() []string {
	return []string{refresh.ClusterSelector().String()}
}

// namespaceDoorbellScopes rings a namespaced row's namespace and All
// Namespaces; a row without a namespace rings All Namespaces only.
func namespaceDoorbellScopes(namespace string) []string {
	all := refresh.AllNamespacesSelector().String()
	if strings.TrimSpace(namespace) == "" {
		return []string{all}
	}
	return []string{refresh.NamespaceSelector(namespace).String(), all}
}
