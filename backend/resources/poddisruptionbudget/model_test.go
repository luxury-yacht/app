package poddisruptionbudget_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
)

// TestBuildResourceModelFactsAndStatus covers the PDB status presentation + facts
// extraction that moved here with the model (was in resourcemodel's policy test).
func TestBuildResourceModelFactsAndStatus(t *testing.T) {
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

	model := poddisruptionbudget.BuildResourceModel("cluster-a", pdb)
	require.Equal(t, "policy", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "PodDisruptionBudget", model.Ref.Kind)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "MinAvailable: 75%, Disruptions Allowed: 1", model.Status.Label)

	facts := poddisruptionbudget.BuildFacts("cluster-a", pdb)
	require.Equal(t, "75%", facts.MinAvailable.Value)
	require.Equal(t, map[string]string{"app": "web"}, facts.Selector)
	require.Equal(t, "Pod", facts.DisruptedPods[0].Pod.Ref.Kind)
	require.Equal(t, "web-0", facts.DisruptedPods[0].Pod.Ref.Name)
	require.Equal(t, "DisruptionAllowed", facts.Conditions[0].Type)
}
