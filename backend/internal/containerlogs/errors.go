package containerlogs

import "strings"

// IsUnavailable identifies a container state with no readable log stream yet.
// API not-found errors retain their separate policy in each transport.
func IsUnavailable(err error) bool {
	errText := err.Error()
	return strings.Contains(errText, "waiting to start") ||
		strings.Contains(errText, "container not found") ||
		(strings.Contains(errText, "previous terminated container") && strings.Contains(errText, "not found")) ||
		strings.Contains(errText, "is not valid for pod") ||
		strings.Contains(errText, "ContainerCreating") ||
		strings.Contains(errText, "PodInitializing")
}
