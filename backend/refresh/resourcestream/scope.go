package resourcestream

import (
	"fmt"
	"strings"
)

func normalizeScopeForDomain(domain, scope string) (string, error) {
	trimmed := strings.TrimSpace(scope)
	switch domain {
	case domainPods:
		return normalizePodScope(trimmed)
	case domainWorkloads:
		return normalizeNamespaceScope(trimmed, "namespace-workloads")
	case domainNamespaceConfig:
		return normalizeNamespaceScope(trimmed, "namespace-config")
	case domainNamespaceRBAC:
		return normalizeNamespaceScope(trimmed, "namespace-rbac")
	case domainNodes:
		if trimmed == "" || strings.EqualFold(strings.TrimSuffix(trimmed, ":"), "cluster") {
			return "", nil
		}
		return "", fmt.Errorf("nodes stream does not accept scope %q", scope)
	default:
		return "", fmt.Errorf("unsupported resource stream domain %q", domain)
	}
}

func normalizePodScope(scope string) (string, error) {
	if scope == "" {
		return "", fmt.Errorf("pods scope is required")
	}
	if strings.HasPrefix(scope, "namespace:") {
		value := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(scope, "namespace:"), ":"))
		if value == "" {
			return "", fmt.Errorf("pods namespace scope is required")
		}
		if isAllNamespace(value) {
			return "namespace:all", nil
		}
		return fmt.Sprintf("namespace:%s", value), nil
	}
	if strings.HasPrefix(scope, "node:") {
		value := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(scope, "node:"), ":"))
		if value == "" {
			return "", fmt.Errorf("pods node scope is required")
		}
		return fmt.Sprintf("node:%s", value), nil
	}
	if strings.HasPrefix(scope, "workload:") {
		value := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(scope, "workload:"), ":"))
		parts := strings.Split(value, ":")
		if len(parts) != 3 {
			return "", fmt.Errorf("pods workload scope requires namespace:kind:name")
		}
		namespace := strings.TrimSpace(parts[0])
		kind := strings.TrimSpace(parts[1])
		name := strings.TrimSpace(parts[2])
		if namespace == "" || kind == "" || name == "" {
			return "", fmt.Errorf("pods workload scope requires namespace:kind:name")
		}
		return fmt.Sprintf("workload:%s:%s:%s", namespace, kind, name), nil
	}
	return "", fmt.Errorf("unsupported pods scope %q", scope)
}

func normalizeNamespaceScope(scope, domain string) (string, error) {
	value := strings.TrimSpace(scope)
	if value == "" {
		return "", fmt.Errorf("%s scope is required", domain)
	}
	if strings.HasPrefix(value, "namespace:") {
		value = strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(value, "namespace:"), ":"))
	}
	if isAllNamespace(value) {
		return "namespace:all", nil
	}
	return fmt.Sprintf("namespace:%s", value), nil
}

func isAllNamespace(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "all" || normalized == "*"
}
