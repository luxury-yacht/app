/*
 * backend/resources/constraints/resource_quotas_test.go
 *
 * Tests for ResourceQuota resource handlers.
 * - Covers ResourceQuota resource handlers behavior and edge cases.
 */

package constraints

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	clientgofake "k8s.io/client-go/kubernetes/fake"
)

func TestServiceResourceQuotaDetails(t *testing.T) {
	rq := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "rq",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-15 * time.Minute)),
		},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{
				corev1.ResourceCPU:    resourceMustParse("4"),
				corev1.ResourceMemory: resourceMustParse("8Gi"),
			},
			Used: corev1.ResourceList{
				corev1.ResourceCPU:    resourceMustParse("2"),
				corev1.ResourceMemory: resourceMustParse("4Gi"),
			},
		},
	}
	rq.Spec.Scopes = []corev1.ResourceQuotaScope{corev1.ResourceQuotaScopeBestEffort}

	client := clientgofake.NewClientset(rq.DeepCopy())
	service := newConstraintsService(t, client)

	detail, err := service.ResourceQuota("default", "rq")
	require.NoError(t, err)
	require.Equal(t, "ResourceQuota", detail.Kind)
	require.Equal(t, "4", detail.Hard[string(corev1.ResourceCPU)])
	require.Equal(t, 50, detail.UsedPercentage[string(corev1.ResourceCPU)])
	require.Contains(t, detail.Details, "Hard limits")
}
