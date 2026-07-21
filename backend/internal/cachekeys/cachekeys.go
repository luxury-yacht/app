/*
 * backend/internal/cachekeys/cachekeys.go
 *
 * Package cachekeys provides utilities for generating consistent cache keys
 * for Kubernetes resource-specific and list operations.
 */

package cachekeys

import "fmt"

// Build generates a consistent key for resource-specific operations.
func Build(resourceKind, namespace, name string) string {
	if namespace == "" {
		return fmt.Sprintf("%s::%s", resourceKind, name)
	}
	return fmt.Sprintf("%s:%s:%s", resourceKind, namespace, name)
}
