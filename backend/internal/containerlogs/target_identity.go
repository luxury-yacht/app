package containerlogs

import (
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// ValidateTargetGVK bounds log selection to the typed Kubernetes clients used by
// both fetch and follow. This leaf cannot import the app's kind registry, whose
// resource services depend on these shared log helpers.
func ValidateTargetGVK(gvk schema.GroupVersionKind) error {
	var expected schema.GroupVersion
	switch strings.ToLower(strings.TrimSpace(gvk.Kind)) {
	case "pod":
		expected = corev1.SchemeGroupVersion
	case "deployment", "replicaset", "daemonset", "statefulset":
		expected = appsv1.SchemeGroupVersion
	case "job", "cronjob":
		expected = batchv1.SchemeGroupVersion
	default:
		return fmt.Errorf("unsupported workload type: %s", gvk.Kind)
	}
	if strings.TrimSpace(gvk.Group) != expected.Group || strings.TrimSpace(gvk.Version) != expected.Version {
		return fmt.Errorf("container logs are not supported for %s", gvk.String())
	}
	return nil
}
