package resourcequota_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/resourcequota"
)

// TestBuildResourceModel covers the ResourceQuota status + facts that moved here
// with the model (was in resourcemodel's policy test).
func TestBuildResourceModel(t *testing.T) {
	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{Name: "rq", Namespace: "default"},
		Spec:       corev1.ResourceQuotaSpec{Scopes: []corev1.ResourceQuotaScope{corev1.ResourceQuotaScopeBestEffort}},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{corev1.ResourcePods: resource.MustParse("10")},
			Used: corev1.ResourceList{corev1.ResourcePods: resource.MustParse("4")},
		},
	}
	model := resourcequota.BuildResourceModel("cluster-a", quota)
	require.Equal(t, "ResourceQuota", model.Ref.Kind)
	require.Equal(t, "Hard limits: 1, Used: 1, Scopes: 1", model.Status.Label)

	facts := resourcequota.BuildFacts(quota)
	hardPods := facts.Hard["pods"]
	usedPods := facts.Used["pods"]
	require.Equal(t, "10", hardPods.String())
	require.Equal(t, "4", usedPods.String())
	require.Equal(t, 40, facts.UsedPercentage["pods"])
	require.Equal(t, []string{"BestEffort"}, facts.Scopes)
}

func TestBuildAggregateCapturesNamespaceQuotaPressure(t *testing.T) {
	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{Name: "rq", Namespace: "team-a"},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{
				corev1.ResourcePods: resource.MustParse("10"),
				corev1.ResourceCPU:  resource.MustParse("2"),
			},
			Used: corev1.ResourceList{
				corev1.ResourcePods: resource.MustParse("8"),
				corev1.ResourceCPU:  resource.MustParse("2400m"),
			},
		},
	}

	aggregate := resourcequota.BuildAggregate(quota)
	require.Equal(t, "team-a", aggregate.Namespace)
	require.Equal(t, 120, aggregate.HighestUsedPercentage)
}
