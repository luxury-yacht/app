package policy

import (
	"context"
	"fmt"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

type pdbTestLogger struct {
	errors []string
}

func (l *pdbTestLogger) Error(msg string, _ ...string) {
	l.errors = append(l.errors, msg)
}

func (pdbTestLogger) Debug(string, ...string) {}
func (pdbTestLogger) Info(string, ...string)  {}
func (pdbTestLogger) Warn(string, ...string)  {}

func TestPodDisruptionBudgetRequiresClient(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{Context: context.Background()}})
	_, err := svc.PodDisruptionBudget("default", "demo")
	require.Error(t, err)

	_, err = svc.PodDisruptionBudgets("default")
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

	client := fake.NewSimpleClientset(pdb)
	logger := &pdbTestLogger{}
	svc := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
		Logger:           logger,
	}})

	resp, err := svc.PodDisruptionBudget("default", "demo")
	require.NoError(t, err)
	require.Equal(t, "PodDisruptionBudget", resp.Kind)
	require.Equal(t, "demo", resp.Name)
	require.Equal(t, "default", resp.Namespace)
	require.NotEmpty(t, resp.Age)
	require.Equal(t, int32(2), resp.CurrentHealthy)
	require.Equal(t, int32(3), resp.DesiredHealthy)
	require.Equal(t, int32(1), resp.DisruptionsAllowed)
	require.Equal(t, int32(4), resp.ExpectedPods)
	require.Equal(t, int64(7), resp.ObservedGeneration)
	require.Contains(t, resp.Details, "Selector: 1 labels")
	require.Contains(t, resp.Details, "MinAvailable: 1")
	require.Contains(t, resp.Details, "MaxUnavailable: 50%")
	require.Len(t, resp.Conditions, 1)

	list, err := svc.PodDisruptionBudgets("default")
	require.NoError(t, err)
	require.Len(t, list, 1)
}

func TestPodDisruptionBudgetListErrorLogs(t *testing.T) {
	client := fake.NewSimpleClientset()
	client.PrependReactor("list", "poddisruptionbudgets", func(action cgotesting.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, fmt.Errorf("boom")
	})
	logger := &pdbTestLogger{}
	svc := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
		Logger:           logger,
	}})

	_, err := svc.PodDisruptionBudgets("default")
	require.Error(t, err)
	require.NotEmpty(t, logger.errors)
}
