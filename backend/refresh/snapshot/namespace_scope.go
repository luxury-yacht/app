package snapshot

import (
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
)

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
