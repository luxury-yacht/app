package common

// RemoveNamedFinalizer preserves the order and values of every other finalizer.
// Namespace spec.finalizers and object metadata.finalizers share this selection
// policy while retaining their distinct Kubernetes update operations.
func RemoveNamedFinalizer[T ~string](current []T, target string) ([]T, bool) {
	remaining := make([]T, 0, len(current))
	removed := false
	for _, value := range current {
		if string(value) == target {
			removed = true
			continue
		}
		remaining = append(remaining, value)
	}
	return remaining, removed
}
