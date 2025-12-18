package cachekeys

import "fmt"

// Build generates a consistent key for resource-specific operations.
func Build(resourceKind, namespace, name string) string {
	if namespace == "" {
		return fmt.Sprintf("%s::%s", resourceKind, name)
	}
	return fmt.Sprintf("%s:%s:%s", resourceKind, namespace, name)
}

// BuildList generates a consistent key for resource list operations.
func BuildList(resourceKind, namespace string) string {
	if namespace == "" {
		return fmt.Sprintf("list:%s", resourceKind)
	}
	return fmt.Sprintf("list:%s:%s", resourceKind, namespace)
}
