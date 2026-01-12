package constraints

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/testsupport"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

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

	client := kubefake.NewClientset(rq.DeepCopy())
	service := newConstraintsService(t, client)

	detail, err := service.ResourceQuota("default", "rq")
	require.NoError(t, err)
	require.Equal(t, "ResourceQuota", detail.Kind)
	require.Equal(t, "4", detail.Hard[string(corev1.ResourceCPU)])
	require.Equal(t, 50, detail.UsedPercentage[string(corev1.ResourceCPU)])
	require.Contains(t, detail.Details, "Hard limits")
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

	client := kubefake.NewClientset(lr.DeepCopy())
	service := newConstraintsService(t, client)

	detail, err := service.LimitRange("default", "lr")
	require.NoError(t, err)
	require.Equal(t, "LimitRange", detail.Kind)
	require.Len(t, detail.Limits, 1)
	require.Equal(t, "Container", detail.Limits[0].Kind)
}

func TestConstraintsRequireClient(t *testing.T) {
	svc := NewService(Dependencies{Common: testsupport.NewResourceDependencies()})

	_, err := svc.ResourceQuota("default", "rq")
	require.Error(t, err)

	_, err = svc.LimitRange("default", "lr")
	require.Error(t, err)
}

func TestConstraintsListFailures(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("list", "resourcequotas", func(_ k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("rq-list-fail")
	})
	client.PrependReactor("list", "limitranges", func(_ k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("lr-list-fail")
	})

	svc := newConstraintsService(t, client)

	_, err := svc.ResourceQuotas("ns1")
	require.Error(t, err)
	_, err = svc.LimitRanges("ns1")
	require.Error(t, err)
}

func newConstraintsService(t testing.TB, client *kubefake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(noopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return NewService(Dependencies{Common: deps})
}

func resourceMustParse(value string) resource.Quantity {
	return resource.MustParse(value)
}
