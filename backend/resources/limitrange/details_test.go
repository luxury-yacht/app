/*
 * backend/resources/limitrange/details_test.go
 *
 * Tests for the LimitRange detail service (co-located with the kind).
 */

package limitrange_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newService(t testing.TB, client *fake.Clientset) *limitrange.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return limitrange.NewService(deps)
}

func TestLimitRangeRequiresClient(t *testing.T) {
	svc := limitrange.NewService(testsupport.NewResourceDependencies())
	_, err := svc.LimitRange("default", "lr")
	require.Error(t, err)
}

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
					corev1.ResourceCPU:    resource.MustParse("500m"),
					corev1.ResourceMemory: resource.MustParse("512Mi"),
				},
				Min: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("100m"),
					corev1.ResourceMemory: resource.MustParse("128Mi"),
				},
			}},
		},
	}

	client := fake.NewClientset(lr.DeepCopy())
	service := newService(t, client)

	detail, err := service.LimitRange("default", "lr")
	require.NoError(t, err)
	require.Equal(t, "LimitRange", detail.Kind)
	require.Len(t, detail.Limits, 1)
	require.Equal(t, "Container", detail.Limits[0].Kind)
}
