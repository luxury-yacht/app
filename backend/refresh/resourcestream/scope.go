package resourcestream

import (
	"strings"
)

func normalizeScopeForDomain(domain, scope string) (string, error) {
	selector, err := ParseStreamSelector("", domain, scope)
	if err != nil {
		return "", err
	}
	return selector.String(), nil
}

func isAllNamespace(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "all" || normalized == "*"
}
