package snapshot

import "strings"

func isAllNamespaceScope(scope string) bool {
	value := strings.TrimSpace(strings.ToLower(scope))
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
