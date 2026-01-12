package pods

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"

	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestGetPodMetricsForPods(t *testing.T) {
	//lint:ignore SA1019 No replacement for the deprecated method
	metricsClient := metricsfake.NewSimpleClientset(&metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "ns"},
	})

	svc := NewService(Dependencies{
		Common: common.Dependencies{
			Context:       context.Background(),
			Logger:        noopLogger{},
			MetricsClient: metricsClient,
		},
	})

	result := svc.GetPodMetricsForPods("ns", []corev1.Pod{
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "ns"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "ns"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-c", Namespace: "ns"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-d", Namespace: "ns"}},
	})

	if result == nil {
		t.Fatalf("expected map, got nil")
	}
}
