package nodes

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestObjectMapStatusUsesKubernetesReadyConditionStatus(t *testing.T) {
	readyCondition := corev1.NodeCondition{
		Type:   corev1.NodeReady,
		Status: corev1.ConditionTrue,
		Reason: "KubeletReady",
	}
	notReadyCondition := corev1.NodeCondition{
		Type:   corev1.NodeReady,
		Status: corev1.ConditionFalse,
		Reason: "KubeletNotReady",
	}

	tests := []struct {
		name             string
		node             corev1.Node
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "ready schedulable",
			node: corev1.Node{Status: corev1.NodeStatus{
				Conditions: []corev1.NodeCondition{readyCondition},
			}},
			wantState:        "True",
			wantLabel:        "Ready",
			wantPresentation: "ready",
		},
		{
			name: "ready unschedulable",
			node: corev1.Node{
				Spec: corev1.NodeSpec{Unschedulable: true},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{readyCondition},
				},
			},
			wantState:        "True",
			wantLabel:        "Ready (Cordoned)",
			wantPresentation: "cordoned",
		},
		{
			name: "ready with unschedulable taint",
			node: corev1.Node{
				Spec: corev1.NodeSpec{Taints: []corev1.Taint{{
					Key:    corev1.TaintNodeUnschedulable,
					Effect: corev1.TaintEffectNoSchedule,
				}}},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{readyCondition},
				},
			},
			wantState:        "True",
			wantLabel:        "Ready (Cordoned)",
			wantPresentation: "cordoned",
		},
		{
			name: "cordoned not ready remains false",
			node: corev1.Node{
				Spec: corev1.NodeSpec{Unschedulable: true},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{notReadyCondition},
				},
			},
			wantState:        "False",
			wantLabel:        "NotReady",
			wantPresentation: "not-ready",
		},
		{
			name: "terminating ready keeps raw ready state with terminating presentation",
			node: func() corev1.Node {
				deletingAt := metav1.NewTime(time.Date(2026, time.May, 7, 20, 15, 0, 0, time.UTC))
				return corev1.Node{
					ObjectMeta: metav1.ObjectMeta{DeletionTimestamp: &deletingAt},
					Status: corev1.NodeStatus{
						Conditions: []corev1.NodeCondition{readyCondition},
					},
				}
			}(),
			wantState:        "True",
			wantLabel:        "Terminating",
			wantPresentation: "terminating",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := ObjectMapStatus("cluster-a", tt.node)
			if status == nil || status.State != tt.wantState || status.Label != tt.wantLabel || status.Presentation != tt.wantPresentation {
				t.Fatalf("unexpected node status: got %#v, want state=%q label=%q presentation=%q", status, tt.wantState, tt.wantLabel, tt.wantPresentation)
			}
		})
	}
}
