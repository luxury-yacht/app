package refresh

import "strings"

const clusterScopeDelimiter = "|"

// clusterListPrefix marks a scope prefix containing a comma-delimited cluster list.
const clusterListPrefix = "clusters="

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

// SplitClusterScopeList parses a cluster selection prefix and returns the IDs plus the trimmed scope.
func SplitClusterScopeList(raw string) ([]string, string) {
	clusterToken, scope := SplitClusterScope(raw)
	if strings.TrimSpace(clusterToken) == "" {
		return nil, scope
	}
	return parseClusterList(clusterToken), scope
}

// JoinClusterScope prefixes scope with cluster identity when available.
func JoinClusterScope(clusterID, scope string) string {
	id := strings.TrimSpace(clusterID)
	value := strings.TrimSpace(scope)
	if id == "" {
		return value
	}
	if value == "" {
		// Preserve the delimiter so split helpers can recover an empty scope.
		return id + clusterScopeDelimiter
	}
	return id + clusterScopeDelimiter + value
}

// parseClusterList splits a cluster selector into unique cluster IDs.
func parseClusterList(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	if strings.HasPrefix(trimmed, clusterListPrefix) {
		trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, clusterListPrefix))
	}
	parts := strings.Split(trimmed, ",")
	if len(parts) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(parts))
	ids := make([]string, 0, len(parts))
	for _, part := range parts {
		id := strings.TrimSpace(part)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}
