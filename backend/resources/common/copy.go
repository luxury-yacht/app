/*
 * backend/resources/common/copy.go
 *
 * Shared copy helpers for resource projections.
 * - Defensive copies that detach DTO data from cached model memory.
 */

package common

// CopyStringMap returns an independent copy of the given map, or nil when the
// input is empty. Resource projections use this so DTOs do not alias the
// shared resource-model maps they are built from.
func CopyStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
