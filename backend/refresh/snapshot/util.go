package snapshot

import (
	"strconv"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// resourceVersionOrTimestamp converts a resource's metadata into a monotonic-ish
// uint64 suitable for snapshot versioning. It prefers the Kubernetes
// ResourceVersion field, falling back to creation timestamp when parsing fails.
func resourceVersionOrTimestamp(obj metav1.Object) uint64 {
	if obj == nil {
		return 0
	}
	if rv := obj.GetResourceVersion(); rv != "" {
		if parsed, err := strconv.ParseUint(rv, 10, 64); err == nil {
			return parsed
		}
	}
	ts := obj.GetCreationTimestamp()
	if ts.IsZero() {
		return 0
	}
	return uint64(ts.UnixNano())
}
