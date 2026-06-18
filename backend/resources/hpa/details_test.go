/*
 * backend/resources/hpa/details_test.go
 *
 * Tests for the HorizontalPodAutoscaler detail service (co-located with the kind).
 */

package hpa

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func resourcePtr(value string) *resource.Quantity {
	q := resource.MustParse(value)
	return &q
}

func ptrToInt32(v int32) *int32 { return &v }

func newHPAService(t testing.TB, client *fake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return NewService(deps)
}

func TestServiceHorizontalPodAutoscalerDetails(t *testing.T) {
	min := int32(1)
	externalAverage := resource.MustParse("50")

	h := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web-hpa",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-30 * time.Minute)),
			Labels:            map[string]string{"app": "web"},
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
			MinReplicas:    &min,
			MaxReplicas:    5,
			Metrics: []autoscalingv2.MetricSpec{{
				Type: autoscalingv2.ResourceMetricSourceType,
				Resource: &autoscalingv2.ResourceMetricSource{
					Name:   corev1.ResourceCPU,
					Target: autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType, AverageUtilization: ptrToInt32(75)},
				},
			}, {
				Type: autoscalingv2.PodsMetricSourceType,
				Pods: &autoscalingv2.PodsMetricSource{
					Metric: autoscalingv2.MetricIdentifier{Name: "requests_per_second"},
					Target: autoscalingv2.MetricTarget{Type: autoscalingv2.AverageValueMetricType, AverageValue: resourcePtr("20")},
				},
			}, {
				Type: autoscalingv2.ExternalMetricSourceType,
				External: &autoscalingv2.ExternalMetricSource{
					Metric: autoscalingv2.MetricIdentifier{Name: "queue_depth"},
					Target: autoscalingv2.MetricTarget{Type: autoscalingv2.AverageValueMetricType, AverageValue: &externalAverage},
				},
			}},
			Behavior: &autoscalingv2.HorizontalPodAutoscalerBehavior{
				ScaleUp: &autoscalingv2.HPAScalingRules{StabilizationWindowSeconds: ptrToInt32(30)},
			},
		},
		Status: autoscalingv2.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 3,
			DesiredReplicas: 4,
			CurrentMetrics: []autoscalingv2.MetricStatus{{
				Type: autoscalingv2.ResourceMetricSourceType,
				Resource: &autoscalingv2.ResourceMetricStatus{
					Name:    corev1.ResourceCPU,
					Current: autoscalingv2.MetricValueStatus{AverageUtilization: ptrToInt32(65)},
				},
			}},
			Conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{Type: autoscalingv2.ScalingActive, Status: corev1.ConditionTrue}},
		},
	}

	service := newHPAService(t, fake.NewClientset(h.DeepCopy()))

	detail, err := service.HorizontalPodAutoscaler("default", "web-hpa")
	require.NoError(t, err)
	require.Equal(t, "HorizontalPodAutoscaler", detail.Kind)
	require.Equal(t, int32(5), detail.MaxReplicas)
	require.Len(t, detail.Metrics, 3)
	require.Len(t, detail.CurrentMetrics, 1)
	require.Contains(t, detail.Details, "Deployment/web")
}

func TestHPAServiceRequiresClient(t *testing.T) {
	svc := NewService(testsupport.NewResourceDependencies())

	_, err := svc.HorizontalPodAutoscaler("default", "missing")
	require.Error(t, err)
}
