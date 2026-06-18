package nodes

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildNodeResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		node             *corev1.Node
		wantLabel        string
		wantState        string
		wantPresentation string
		wantReason       string
		wantSignal       resourcemodel.ResourceStatusSignal
		wantBadge        resourcemodel.ResourceStatusBadge
	}{
		{
			name:             "ready",
			node:             nodeWithReadyCondition(corev1.ConditionTrue, "KubeletReady"),
			wantLabel:        "Ready",
			wantState:        string(corev1.ConditionTrue),
			wantPresentation: "ready",
		},
		{
			name: "ready cordoned",
			node: func() *corev1.Node {
				node := nodeWithReadyCondition(corev1.ConditionTrue, "KubeletReady")
				node.Spec.Unschedulable = true
				return node
			}(),
			wantLabel:        "Ready (Cordoned)",
			wantState:        string(corev1.ConditionTrue),
			wantPresentation: "cordoned",
			wantReason:       "Unschedulable",
			wantSignal: resourcemodel.ResourceStatusSignal{
				Type:   resourcemodel.StatusSignalResourceState,
				Name:   "spec.unschedulable",
				Status: "true",
				Reason: "Unschedulable",
			},
			wantBadge: resourcemodel.ResourceStatusBadge{Text: "Cordoned", Status: "true"},
		},
		{
			name: "ready with unschedulable taint",
			node: func() *corev1.Node {
				node := nodeWithReadyCondition(corev1.ConditionTrue, "KubeletReady")
				node.Spec.Taints = []corev1.Taint{{
					Key:    corev1.TaintNodeUnschedulable,
					Effect: corev1.TaintEffectNoSchedule,
				}}
				return node
			}(),
			wantLabel:        "Ready (Cordoned)",
			wantState:        string(corev1.ConditionTrue),
			wantPresentation: "cordoned",
			wantReason:       "Unschedulable",
			wantSignal: resourcemodel.ResourceStatusSignal{
				Type:   resourcemodel.StatusSignalResourceState,
				Name:   corev1.TaintNodeUnschedulable,
				Status: string(corev1.TaintEffectNoSchedule),
				Reason: "UnschedulableTaint",
			},
			wantBadge: resourcemodel.ResourceStatusBadge{Text: "Cordoned", Status: string(corev1.TaintEffectNoSchedule)},
		},
		{
			name:             "not ready",
			node:             nodeWithReadyCondition(corev1.ConditionFalse, "KubeletNotReady"),
			wantLabel:        "NotReady",
			wantState:        string(corev1.ConditionFalse),
			wantPresentation: "not-ready",
			wantReason:       "KubeletNotReady",
		},
		{
			name:             "unknown",
			node:             nodeWithReadyCondition(corev1.ConditionUnknown, "NodeStatusUnknown"),
			wantLabel:        "Unknown",
			wantState:        string(corev1.ConditionUnknown),
			wantPresentation: "unknown",
			wantReason:       "NodeStatusUnknown",
		},
		{
			name: "terminating",
			node: func() *corev1.Node {
				node := nodeWithReadyCondition(corev1.ConditionTrue, "KubeletReady")
				deletingAt := metav1.NewTime(time.Date(2026, time.May, 7, 20, 15, 0, 0, time.UTC))
				node.DeletionTimestamp = &deletingAt
				return node
			}(),
			wantLabel:        "Terminating",
			wantState:        string(corev1.ConditionTrue),
			wantPresentation: "terminating",
			wantReason:       "DeletionTimestamp",
			wantSignal: resourcemodel.ResourceStatusSignal{
				Type:   resourcemodel.StatusSignalDeletion,
				Name:   "metadata.deletionTimestamp",
				Status: "2026-05-07T20:15:00Z",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := BuildResourceModel("cluster-a", tt.node)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "Node", model.Ref.Kind)
			require.Equal(t, "nodes", model.Ref.Resource)
			require.Equal(t, "node-1", model.Ref.Name)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)
			if tt.wantSignal.Name != "" {
				require.Contains(t, model.Status.Signals, tt.wantSignal)
			}
			if tt.wantBadge.Text != "" {
				require.Contains(t, model.Status.Badges, tt.wantBadge)
			}
		})
	}
}

func TestBuildNodeResourceModelCopiesMetadataAndFacts(t *testing.T) {
	node := nodeWithReadyCondition(corev1.ConditionTrue, "KubeletReady")
	node.UID = types.UID("uid-1")
	node.Labels = map[string]string{
		"node-role.kubernetes.io/worker": "",
		"app":                            "node",
	}
	node.Annotations = map[string]string{"example": "annotation"}
	node.Finalizers = []string{"example.com/finalizer"}

	model := BuildResourceModel("cluster-a", node)
	require.Equal(t, "uid-1", model.Ref.UID)
	require.Equal(t, map[string]string{"node-role.kubernetes.io/worker": "", "app": "node"}, model.Metadata.Labels)
	require.Equal(t, map[string]string{"example": "annotation"}, model.Metadata.Annotations)

	facts := BuildFacts(node)
	require.Equal(t, []string{"worker"}, facts.Roles)
	require.False(t, facts.Unschedulable)
	require.False(t, facts.Cordoned)

	node.Labels["app"] = "changed"
	require.Equal(t, "node", model.Metadata.Labels["app"])
}

func nodeWithReadyCondition(status corev1.ConditionStatus, reason string) *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{{
				Type:   corev1.NodeReady,
				Status: status,
				Reason: reason,
			}},
		},
	}
}
