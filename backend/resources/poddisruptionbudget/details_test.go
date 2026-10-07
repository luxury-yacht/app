/*
 * backend/resources/poddisruptionbudget/details_test.go
 *
 * Tests for the PodDisruptionBudget detail service (co-located with the kind).
 */

package poddisruptionbudget

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
)

// errorCapturingLogger stores error messages for assertions in tests.
type errorCapturingLogger struct {
	errors []string
}

func (l *errorCapturingLogger) Error(msg string, _ ...string) {
	l.errors = append(l.errors, msg)
}

func (errorCapturingLogger) Debug(string, ...string) {}
func (errorCapturingLogger) Info(string, ...string)  {}
func (errorCapturingLogger) Warn(string, ...string)  {}

func TestPodDisruptionBudgetRequiresClient(t *testing.T) {
	svc := NewService(common.Dependencies{})
	_, err := svc.PodDisruptionBudget(context.Background(), "default", "demo")
	require.Error(t, err)
}

func TestPodDisruptionBudgetDetailsFormatting(t *testing.T) {
	minAvail := intstr.FromInt(1)
	maxUnavailable := intstr.FromString("50%")
	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "demo",
			Namespace:   "default",
			Annotations: map[string]string{"anno": "1"},
			Labels:      map[string]string{"lbl": "1"},
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MinAvailable:   &minAvail,
			MaxUnavailable: &maxUnavailable,
			Selector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
		},
		Status: policyv1.PodDisruptionBudgetStatus{
			CurrentHealthy:     2,
			DesiredHealthy:     3,
			DisruptionsAllowed: 1,
			ExpectedPods:       4,
			ObservedGeneration: 7,
			DisruptedPods:      map[string]metav1.Time{"old": {}},
			Conditions: []metav1.Condition{{
				Type:    "Ready",
				Status:  "True",
				Reason:  "Ok",
				Message: "all good",
			}},
		},
	}

	client := fake.NewClientset(pdb)
	logger := &errorCapturingLogger{}
	svc := NewService(common.Dependencies{
		KubernetesClient: client,
		Logger:           logger,
	})

	resp, err := svc.PodDisruptionBudget(context.Background(), "default", "demo")
	require.NoError(t, err)
	require.Equal(t, "PodDisruptionBudget", resp.Kind)
	require.Equal(t, "demo", resp.Name)
	require.Equal(t, "default", resp.Namespace)
	require.Equal(t, int32(2), resp.CurrentHealthy)
	require.Equal(t, int32(3), resp.DesiredHealthy)
	require.Equal(t, int32(1), resp.DisruptionsAllowed)
	require.Equal(t, int32(4), resp.ExpectedPods)
	require.Equal(t, int64(7), resp.ObservedGeneration)
	require.Contains(t, resp.Details, "Selector: 1 labels")
	require.Contains(t, resp.Details, "MinAvailable: 1")
	require.Contains(t, resp.Details, "MaxUnavailable: 50%")
	require.Len(t, resp.Conditions, 1)
}

// detailsWire fetches a PDB through the detail service and returns its JSON wire shape, which is the
// contract the frontend Overview reads.
func detailsWire(t *testing.T, pdb *policyv1.PodDisruptionBudget) map[string]any {
	t.Helper()
	svc := NewService(common.Dependencies{
		KubernetesClient: fake.NewClientset(pdb),
		Logger:           &errorCapturingLogger{},
		ClusterID:        "cluster-a",
	})
	resp, err := svc.PodDisruptionBudget(context.Background(), pdb.Namespace, pdb.Name)
	require.NoError(t, err)
	raw, err := json.Marshal(resp)
	require.NoError(t, err)
	var wire map[string]any
	require.NoError(t, json.Unmarshal(raw, &wire))
	return wire
}

// A missing selector matches no pods while an empty one matches every pod in the namespace, and
// matchExpressions narrow the match; the Overview can only explain coverage if all three survive.
func TestPodDisruptionBudgetDetailsKeepsSelectorSemantics(t *testing.T) {
	pdbWith := func(selector *metav1.LabelSelector) *policyv1.PodDisruptionBudget {
		return &policyv1.PodDisruptionBudget{
			ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
			Spec:       policyv1.PodDisruptionBudgetSpec{Selector: selector},
		}
	}

	_, present := detailsWire(t, pdbWith(nil))["selector"]
	require.False(t, present, "a missing selector must stay absent on the wire")

	require.Equal(t, map[string]any{}, detailsWire(t, pdbWith(&metav1.LabelSelector{}))["selector"])

	require.Equal(t, map[string]any{
		"matchLabels": map[string]any{"app": "web"},
		"matchExpressions": []any{
			map[string]any{"key": "tier", "operator": "In", "values": []any{"frontend", "web"}},
		},
	}, detailsWire(t, pdbWith(&metav1.LabelSelector{
		MatchLabels: map[string]string{"app": "web"},
		MatchExpressions: []metav1.LabelSelectorRequirement{
			{Key: "tier", Operator: metav1.LabelSelectorOpIn, Values: []string{"frontend", "web"}},
		},
	}))["selector"])
}

// The Health section explains why evictions are blocked (the controller's DisruptionAllowed reason and
// message), links each disrupted pod to its cluster-scoped Pod, and the Budget section shows the
// unhealthy-pod eviction policy.
func TestPodDisruptionBudgetDetailsProjectsEvictionState(t *testing.T) {
	policy := policyv1.AlwaysAllow
	evicted := metav1.NewTime(metav1.Now().Rfc3339Copy().Time)
	wire := detailsWire(t, &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       policyv1.PodDisruptionBudgetSpec{UnhealthyPodEvictionPolicy: &policy},
		Status: policyv1.PodDisruptionBudgetStatus{
			DisruptedPods: map[string]metav1.Time{"web-b": evicted, "web-a": evicted},
			Conditions: []metav1.Condition{{
				Type:    policyv1.DisruptionAllowedCondition,
				Status:  metav1.ConditionFalse,
				Reason:  policyv1.SyncFailedReason,
				Message: "found no controllers for pod web-a",
			}},
		},
	})

	require.Equal(t, "AlwaysAllow", wire["unhealthyPodEvictionPolicy"])

	conditions, ok := wire["conditions"].([]any)
	require.True(t, ok, "conditions must be structured, got %T", wire["conditions"])
	require.Len(t, conditions, 1)
	require.Equal(t, map[string]any{
		"type":    "DisruptionAllowed",
		"status":  "False",
		"reason":  "SyncFailed",
		"message": "found no controllers for pod web-a",
	}, conditions[0])

	disrupted, ok := wire["disruptedPods"].([]any)
	require.True(t, ok, "disrupted pods must be a list of pod links, got %T", wire["disruptedPods"])
	names := make([]string, 0, len(disrupted))
	for _, entry := range disrupted {
		pod := entry.(map[string]any)
		require.NotEmpty(t, pod["disruptionTime"])
		ref := pod["pod"].(map[string]any)["ref"].(map[string]any)
		require.Equal(t, "cluster-a", ref["clusterId"])
		require.Equal(t, "v1", ref["version"])
		require.Equal(t, "Pod", ref["kind"])
		require.Equal(t, "default", ref["namespace"])
		names = append(names, ref["name"].(string))
	}
	// Sorted so the list does not reshuffle on every refetch of the map-backed status.
	require.Equal(t, []string{"web-a", "web-b"}, names)
}

func TestPodDisruptionBudgetDetailsLeavesUnsetEvictionPolicyAbsent(t *testing.T) {
	wire := detailsWire(t, &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
	})
	_, present := wire["unhealthyPodEvictionPolicy"]
	require.False(t, present, "an unset policy must stay distinguishable from an explicit one")
}
