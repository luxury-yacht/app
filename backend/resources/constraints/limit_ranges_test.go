/*
 * backend/resources/constraints/limit_ranges_test.go
 *
 * Tests for LimitRange resource handlers.
 * - Covers LimitRange resource handlers behavior and edge cases.
 */

package constraints

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestServiceLimitRangeDetails(t *testing.T) {
	lr := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "lr",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-10 * time.Minute)),
		},
		Spec: corev1.LimitRangeSpec{
			Limits: []corev1.LimitRangeItem{{
				Type: corev1.LimitTypeContainer,
				Max: corev1.ResourceList{
					corev1.ResourceCPU:    resourceMustParse("500m"),
					corev1.ResourceMemory: resourceMustParse("512Mi"),
				},
				Min: corev1.ResourceList{
					corev1.ResourceCPU:    resourceMustParse("100m"),
					corev1.ResourceMemory: resourceMustParse("128Mi"),
				},
			}},
		},
	}

	client := fake.NewClientset(lr.DeepCopy())
	service := newConstraintsService(t, client)

	detail, err := service.LimitRange("default", "lr")
	require.NoError(t, err)
	require.Equal(t, "LimitRange", detail.Kind)
	require.Len(t, detail.Limits, 1)
	require.Equal(t, "Container", detail.Limits[0].Kind)
}
