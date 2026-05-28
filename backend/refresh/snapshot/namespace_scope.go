package snapshot

import (
	"errors"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
)

// NamespaceSnapshotScope is the parsed identity for namespace-scoped snapshot
// builders. Namespace is empty only when AllNamespaces is true.
type NamespaceSnapshotScope struct {
	ClusterID      string
	Namespace      string
	AllNamespaces  bool
	CanonicalScope string
}

func parseNamespaceSnapshotScope(scope, requiredMessage string) (NamespaceSnapshotScope, error) {
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return NamespaceSnapshotScope{}, errors.New(requiredMessage)
	}

	if isAllNamespaceScope(trimmed) {
		return NamespaceSnapshotScope{
			ClusterID:      clusterID,
			AllNamespaces:  true,
			CanonicalScope: refresh.JoinClusterScope(clusterID, "namespace:all"),
		}, nil
	}

	namespace, err := parseNamespaceScopeValue(trimmed, requiredMessage)
	if err != nil {
		return NamespaceSnapshotScope{}, err
	}
	return NamespaceSnapshotScope{
		ClusterID:      clusterID,
		Namespace:      namespace,
		CanonicalScope: refresh.JoinClusterScope(clusterID, "namespace:"+namespace),
	}, nil
}

func parseNamespaceScopeValue(scope, requiredMessage string) (string, error) {
	_, scopeValue := refresh.SplitClusterScope(scope)
	namespace := strings.TrimSpace(scopeValue)
	if strings.HasPrefix(namespace, "namespace:") {
		namespace = strings.TrimPrefix(namespace, "namespace:")
		namespace = strings.TrimLeft(namespace, ":")
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return "", errors.New(requiredMessage)
	}
	return namespace, nil
}

func isAllNamespaceScope(scope string) bool {
	_, scopeValue := refresh.SplitClusterScope(scope)
	value := strings.TrimSpace(strings.ToLower(scopeValue))
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "namespace:") {
		value = strings.TrimLeft(strings.TrimPrefix(value, "namespace:"), ":")
	}
	switch value {
	case "all", "*":
		return true
	default:
		return false
	}
}
