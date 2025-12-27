package refresh

import "strings"

const clusterScopeDelimiter = "|"

// SplitClusterScope separates the optional cluster prefix from a scope string.
func SplitClusterScope(raw string) (string, string) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", ""
	}
	parts := strings.SplitN(trimmed, clusterScopeDelimiter, 2)
	if len(parts) == 2 && strings.TrimSpace(parts[0]) != "" {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", trimmed
}

// JoinClusterScope prefixes scope with cluster identity when available.
func JoinClusterScope(clusterID, scope string) string {
	id := strings.TrimSpace(clusterID)
	value := strings.TrimSpace(scope)
	if id == "" {
		return value
	}
	if value == "" {
		return id
	}
	return id + clusterScopeDelimiter + value
}
