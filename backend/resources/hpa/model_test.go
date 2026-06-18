package hpa

import (
	"testing"

	"github.com/stretchr/testify/require"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildResourceModelFactsStatusAndScaleTarget(t *testing.T) {
	min := int32(2)
	utilization := int32(80)
	h := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: types.UID("hpa-uid")},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
			MinReplicas:    &min,
			MaxReplicas:    5,
			Metrics: []autoscalingv2.MetricSpec{{
				Type: autoscalingv2.ResourceMetricSourceType,
				Resource: &autoscalingv2.ResourceMetricSource{
					Name:   corev1.ResourceCPU,
					Target: autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType, AverageUtilization: &utilization},
				},
			}},
		},
		Status: autoscalingv2.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 3,
			DesiredReplicas: 4,
			Conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{
				Type: autoscalingv2.ScalingActive, Status: corev1.ConditionTrue, Reason: "ValidMetricFound",
			}},
		},
	}

	model := BuildResourceModel("cluster-a", h)
	require.Equal(t, "autoscaling", model.Ref.Group)
	require.Equal(t, "v2", model.Ref.Version)
	require.Equal(t, "HorizontalPodAutoscaler", model.Ref.Kind)
	require.Equal(t, "horizontalpodautoscalers", model.Ref.Resource)
	require.Equal(t, "3/4", model.Status.State)
	require.Equal(t, "3/4 replicas", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)

	facts := BuildFacts("cluster-a", h)
	require.Equal(t, "Deployment", facts.ScaleTarget.Ref.Kind)
	require.Equal(t, "apps", facts.ScaleTarget.Ref.Group)
	require.Equal(t, "v1", facts.ScaleTarget.Ref.Version)
	require.Equal(t, "web", facts.ScaleTarget.Ref.Name)
	require.Equal(t, &min, facts.MinReplicas)
	require.Equal(t, int32(5), facts.MaxReplicas)
	require.Equal(t, "80%", facts.Metrics[0].Target["averageUtilization"])
	require.Equal(t, "ScalingActive", facts.Conditions[0].Type)
}

func TestBuildV1ResourceModelKeepsTargetAPIVersion(t *testing.T) {
	min := int32(1)
	h := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "rollout-hpa", Namespace: "default"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "argoproj.io/v1alpha1", Kind: "Rollout", Name: "web"},
			MinReplicas:    &min,
			MaxReplicas:    4,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{CurrentReplicas: 2, DesiredReplicas: 2},
	}

	model := BuildV1ResourceModel("cluster-a", h)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "2", model.Status.State)
	require.Equal(t, "2 replicas", model.Status.Label)

	facts := BuildV1Facts("cluster-a", h)
	require.Equal(t, "argoproj.io", facts.ScaleTarget.Ref.Group)
	require.Equal(t, "v1alpha1", facts.ScaleTarget.Ref.Version)
	require.Equal(t, "Rollout", facts.ScaleTarget.Ref.Kind)
}

func TestBuildFactsUsesDisplayTargetForInvalidAPIVersion(t *testing.T) {
	h := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "broken-target", Namespace: "default"},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "not/a/valid/api/version", Kind: "Widget", Name: "web"},
			MaxReplicas:    3,
		},
	}

	facts := BuildFacts("cluster-a", h)
	require.Nil(t, facts.ScaleTarget.Ref)
	require.NotNil(t, facts.ScaleTarget.Display)
	require.Equal(t, "Widget", facts.ScaleTarget.Display.Kind)
	require.Equal(t, "web", facts.ScaleTarget.Display.Name)
	require.Equal(t, "", facts.ScaleTarget.Display.Version)
}
