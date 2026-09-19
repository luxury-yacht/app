package hpa

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"

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

func TestStreamRetainsTargetAPIVersionAndPrimaryIdentity(t *testing.T) {
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

	row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, h)
	require.Equal(t, "argoproj.io/v1alpha1", row.TargetAPIVersion)
	require.Equal(t, "Rollout/web", row.Target)
	require.Equal(t, "cluster-a", row.Ref.ClusterID)
	require.Equal(t, "autoscaling", row.Ref.Group)
	require.Equal(t, "v2", row.Ref.Version)
	require.Equal(t, "HorizontalPodAutoscaler", row.Ref.Kind)
	require.Equal(t, int32(1), row.Min)
	require.Equal(t, int32(4), row.Max)
	require.Equal(t, int32(2), row.Current)
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

func TestMapStatusKeepsScalingFailuresAndDeletionPrecedence(t *testing.T) {
	for _, tt := range []struct {
		name                         string
		conditions                   []autoscalingv2.HorizontalPodAutoscalerCondition
		deleting                     bool
		wantPresentation, wantReason string
	}{
		{name: "replicas agree", wantPresentation: "ready"},
		{name: "unrelated false condition", conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{Type: autoscalingv2.ScalingLimited, Status: corev1.ConditionFalse}}, wantPresentation: "ready"},
		{name: "cannot scale", conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{Type: autoscalingv2.AbleToScale, Status: corev1.ConditionFalse}}, wantPresentation: "warning"},
		{name: "metrics unavailable", conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{Type: autoscalingv2.ScalingActive, Status: corev1.ConditionFalse, Reason: "FailedGetResourceMetric"}}, wantPresentation: "warning", wantReason: "FailedGetResourceMetric"},
		{name: "deletion wins", conditions: []autoscalingv2.HorizontalPodAutoscalerCondition{{Type: autoscalingv2.ScalingActive, Status: corev1.ConditionFalse, Reason: "FailedGetResourceMetric"}}, deleting: true, wantPresentation: "terminating", wantReason: "DeletionTimestamp"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h := &autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "team-a"}, Status: autoscalingv2.HorizontalPodAutoscalerStatus{CurrentReplicas: 2, DesiredReplicas: 2, Conditions: tt.conditions}}
			if tt.deleting {
				now := metav1.Now()
				h.DeletionTimestamp = &now
			}
			status := ObjectMapStatus("cluster-a", h)
			require.Equal(t, tt.wantPresentation, status.Presentation)
			require.Equal(t, tt.wantReason, status.Reason)
			model := BuildResourceModel("cluster-a", h)
			require.Equal(t, "status.currentReplicas", model.Status.Signals[0].Name)
			require.Equal(t, "status.desiredReplicas", model.Status.Signals[1].Name)
			if len(tt.conditions) > 0 {
				require.Equal(t, string(tt.conditions[0].Type), model.Status.Signals[2].Name)
				require.Equal(t, tt.conditions[0].Reason, model.Status.Signals[2].Reason)
			}
		})
	}
}

func TestMapEdgeKeepsCustomTargetIdentity(t *testing.T) {
	h := &autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: metav1.ObjectMeta{Name: "custom", Namespace: "team-a"}, Spec: autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "custom.example.com/v2", Kind: "Deployment", Name: "api"}}}
	edges := ObjectMapEdges("cluster-a", h)
	require.Len(t, edges, 1)
	ref := edges[0].Link.Ref
	require.NotNil(t, ref)
	require.Equal(t, "cluster-a", ref.ClusterID)
	require.Equal(t, "custom.example.com", ref.Group)
	require.Equal(t, "v2", ref.Version)
	require.Equal(t, "Deployment", ref.Kind)
	require.Equal(t, "team-a", ref.Namespace)
	require.Equal(t, "api", ref.Name)
	require.Nil(t, ObjectMapEdges("cluster-a", &corev1.Pod{}))
}
