/*
 * backend/resources/resourcequota/details_test.go
 *
 * Tests for the ResourceQuota detail service (co-located with the kind).
 */

package resourcequota_test

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
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newService(t testing.TB, client *fake.Clientset) *resourcequota.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return resourcequota.NewService(deps)
}

func TestResourceQuotaRequiresClient(t *testing.T) {
	svc := resourcequota.NewService(testsupport.NewResourceDependencies())
	_, err := svc.ResourceQuota("default", "rq")
	require.Error(t, err)
}

func TestServiceResourceQuotaDetails(t *testing.T) {
	rq := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "rq",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-15 * time.Minute)),
		},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
			Used: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("2"),
				corev1.ResourceMemory: resource.MustParse("4Gi"),
			},
		},
	}
	rq.Spec.Scopes = []corev1.ResourceQuotaScope{corev1.ResourceQuotaScopeBestEffort}

	client := fake.NewClientset(rq.DeepCopy())
	service := newService(t, client)

	detail, err := service.ResourceQuota("default", "rq")
	require.NoError(t, err)
	require.Equal(t, "ResourceQuota", detail.Kind)
	require.Equal(t, "4", detail.Hard[string(corev1.ResourceCPU)])
	require.Equal(t, 50, detail.UsedPercentage[string(corev1.ResourceCPU)])
	require.Contains(t, detail.Details, "Hard limits")
}
