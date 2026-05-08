package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestBuildHorizontalPodAutoscalerResourceModelFactsStatusAndScaleTarget(t *testing.T) {
	min := int32(2)
	utilization := int32(80)
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: types.UID("hpa-uid")},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
			MinReplicas: &min,
			MaxReplicas: 5,
			Metrics: []autoscalingv2.MetricSpec{{
				Type: autoscalingv2.ResourceMetricSourceType,
				Resource: &autoscalingv2.ResourceMetricSource{
					Name: corev1.ResourceCPU,
					Target: autoscalingv2.MetricTarget{
						Type:               autoscalingv2.UtilizationMetricType,
						AverageUtilization: &utilization,
					},
				},
			}},
		},
		Status: autoscalingv2.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 3,
			DesiredReplicas: 4,
			Conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{
				Type:   autoscalingv2.ScalingActive,
				Status: corev1.ConditionTrue,
				Reason: "ValidMetricFound",
			}},
		},
	}

	model := BuildHorizontalPodAutoscalerResourceModel("cluster-a", hpa)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "autoscaling", model.Ref.Group)
	require.Equal(t, "v2", model.Ref.Version)
	require.Equal(t, "HorizontalPodAutoscaler", model.Ref.Kind)
	require.Equal(t, "horizontalpodautoscalers", model.Ref.Resource)
	require.Equal(t, ResourceScopeNamespaced, model.Scope)
	require.Equal(t, "3/4", model.Status.State)
	require.Equal(t, "3/4 replicas", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)
	require.Equal(t, "Deployment", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Kind)
	require.Equal(t, "apps", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Group)
	require.Equal(t, "v1", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Version)
	require.Equal(t, "web", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Name)
	require.Equal(t, &min, model.Facts.HorizontalPodAutoscaler.MinReplicas)
	require.Equal(t, int32(5), model.Facts.HorizontalPodAutoscaler.MaxReplicas)
	require.Equal(t, "80%", model.Facts.HorizontalPodAutoscaler.Metrics[0].Target["averageUtilization"])
	require.Equal(t, "ScalingActive", model.Facts.HorizontalPodAutoscaler.Conditions[0].Type)
}

func TestBuildHorizontalPodAutoscalerV1ResourceModelKeepsTargetAPIVersion(t *testing.T) {
	min := int32(1)
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "rollout-hpa", Namespace: "default"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "argoproj.io/v1alpha1",
				Kind:       "Rollout",
				Name:       "web",
			},
			MinReplicas: &min,
			MaxReplicas: 4,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{CurrentReplicas: 2, DesiredReplicas: 2},
	}

	model := BuildHorizontalPodAutoscalerV1ResourceModel("cluster-a", hpa)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "argoproj.io", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Group)
	require.Equal(t, "v1alpha1", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Version)
	require.Equal(t, "Rollout", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref.Kind)
	require.Equal(t, "2", model.Status.State)
	require.Equal(t, "2 replicas", model.Status.Label)
}

func TestBuildHorizontalPodAutoscalerResourceModelUsesDisplayTargetForInvalidAPIVersion(t *testing.T) {
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "broken-target", Namespace: "default"},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "not/a/valid/api/version",
				Kind:       "Widget",
				Name:       "web",
			},
			MaxReplicas: 3,
		},
	}

	model := BuildHorizontalPodAutoscalerResourceModel("cluster-a", hpa)
	require.Nil(t, model.Facts.HorizontalPodAutoscaler.ScaleTarget.Ref)
	require.NotNil(t, model.Facts.HorizontalPodAutoscaler.ScaleTarget.Display)
	require.Equal(t, "Widget", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Display.Kind)
	require.Equal(t, "web", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Display.Name)
	require.Equal(t, "", model.Facts.HorizontalPodAutoscaler.ScaleTarget.Display.Version)
}

func TestBuildPodDisruptionBudgetResourceModelFactsAndStatus(t *testing.T) {
	minAvailable := intstr.FromString("75%")
	disruptionTime := metav1.Now()
	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "web-pdb", Namespace: "default"},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MinAvailable: &minAvailable,
			Selector:     &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
		Status: policyv1.PodDisruptionBudgetStatus{
			DisruptionsAllowed: 1,
			CurrentHealthy:     3,
			DesiredHealthy:     2,
			ExpectedPods:       4,
			DisruptedPods:      map[string]metav1.Time{"web-0": disruptionTime},
			Conditions:         []metav1.Condition{{Type: "DisruptionAllowed", Status: metav1.ConditionTrue}},
		},
	}

	model := BuildPodDisruptionBudgetResourceModel("cluster-a", pdb)
	require.Equal(t, "policy", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "PodDisruptionBudget", model.Ref.Kind)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "MinAvailable: 75%, Disruptions Allowed: 1", model.Status.Label)
	require.Equal(t, "75%", model.Facts.PodDisruptionBudget.MinAvailable.Value)
	require.Equal(t, map[string]string{"app": "web"}, model.Facts.PodDisruptionBudget.Selector)
	require.Equal(t, "Pod", model.Facts.PodDisruptionBudget.DisruptedPods[0].Pod.Ref.Kind)
	require.Equal(t, "web-0", model.Facts.PodDisruptionBudget.DisruptedPods[0].Pod.Ref.Name)
	require.Equal(t, "DisruptionAllowed", model.Facts.PodDisruptionBudget.Conditions[0].Type)
}

func TestBuildResourceQuotaAndLimitRangeResourceModels(t *testing.T) {
	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{Name: "rq", Namespace: "default"},
		Spec:       corev1.ResourceQuotaSpec{Scopes: []corev1.ResourceQuotaScope{corev1.ResourceQuotaScopeBestEffort}},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{corev1.ResourcePods: resource.MustParse("10")},
			Used: corev1.ResourceList{corev1.ResourcePods: resource.MustParse("4")},
		},
	}
	quotaModel := BuildResourceQuotaResourceModel("cluster-a", quota)
	require.Equal(t, "ResourceQuota", quotaModel.Ref.Kind)
	require.Equal(t, "Hard limits: 1, Used: 1, Scopes: 1", quotaModel.Status.Label)
	require.Equal(t, "10", quotaModel.Facts.ResourceQuota.Hard["pods"])
	require.Equal(t, "4", quotaModel.Facts.ResourceQuota.Used["pods"])
	require.Equal(t, 40, quotaModel.Facts.ResourceQuota.UsedPercentage["pods"])
	require.Equal(t, []string{"BestEffort"}, quotaModel.Facts.ResourceQuota.Scopes)

	limitRange := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{Name: "limits", Namespace: "default"},
		Spec: corev1.LimitRangeSpec{Limits: []corev1.LimitRangeItem{{
			Type: corev1.LimitTypeContainer,
			Max:  corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("2")},
			Min:  corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("128Mi")},
		}}},
	}
	limitModel := BuildLimitRangeResourceModel("cluster-a", limitRange)
	require.Equal(t, "LimitRange", limitModel.Ref.Kind)
	require.Equal(t, "1 limit(s) - Type: Container", limitModel.Status.Label)
	require.Equal(t, "Container", limitModel.Facts.LimitRange.Limits[0].Kind)
	require.Equal(t, "2", limitModel.Facts.LimitRange.Limits[0].Max["cpu"])
	require.Equal(t, "128Mi", limitModel.Facts.LimitRange.Limits[0].Min["memory"])
}
