package limitrange_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/limitrange"
)

// TestBuildResourceModel covers the LimitRange status + facts that moved here with
// the model (was in resourcemodel's policy test).
func TestBuildResourceModel(t *testing.T) {
	lr := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{Name: "limits", Namespace: "default"},
		Spec: corev1.LimitRangeSpec{Limits: []corev1.LimitRangeItem{{
			Type: corev1.LimitTypeContainer,
			Max:  corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("2")},
			Min:  corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("128Mi")},
		}}},
	}
	model := limitrange.BuildResourceModel("cluster-a", lr)
	require.Equal(t, "LimitRange", model.Ref.Kind)
	require.Equal(t, "1 limit(s) - Type: Container", model.Status.Label)

	facts := limitrange.BuildFacts(lr)
	require.Equal(t, "Container", facts.Limits[0].Kind)
	maxCPU := facts.Limits[0].Max["cpu"]
	minMemory := facts.Limits[0].Min["memory"]
	require.Equal(t, "2", maxCPU.String())
	require.Equal(t, "128Mi", minMemory.String())
}
