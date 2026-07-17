package daemonset_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/daemonset"
)

func daemonSetWithReplicas(desired, current, ready, available int32) *appsv1.DaemonSet {
	return &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: "daemon", Namespace: "default"},
		Status: appsv1.DaemonSetStatus{
			DesiredNumberScheduled: desired,
			CurrentNumberScheduled: current,
			NumberReady:            ready,
			NumberAvailable:        available,
			UpdatedNumberScheduled: current,
		},
	}
}

// TestBuildResourceModelStatus covers the DaemonSet status presentation that
// moved here with the model (was a case in resourcemodel's workload status test).
func TestBuildResourceModelStatus(t *testing.T) {
	model := daemonset.BuildResourceModel("cluster-a", daemonSetWithReplicas(3, 3, 3, 3))
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "apps", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "DaemonSet", model.Ref.Kind)
	require.Equal(t, "daemonsets", model.Ref.Resource)
	require.Equal(t, "default", model.Ref.Namespace)
	require.Equal(t, "daemon", model.Ref.Name)
	require.Equal(t, "3/3", model.Status.State)
	require.Equal(t, "Running", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
}

func TestBuildResourceModelStatusReportsNoEligibleNodes(t *testing.T) {
	model := daemonset.BuildResourceModel("cluster-a", daemonSetWithReplicas(0, 0, 0, 0))

	require.Equal(t, "0/0", model.Status.State)
	require.Equal(t, "No eligible nodes", model.Status.Label)
	require.Equal(t, "NoEligibleNodes", model.Status.Reason)
	require.Equal(t, "warning", model.Status.Presentation)
}
