package replicaset_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/replicaset"
)

func ptrInt32(v int32) *int32 { return &v }

func replicaSetWithReplicas(desired, ready, available int32) *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Name: "replica", Namespace: "default"},
		Spec:       appsv1.ReplicaSetSpec{Replicas: ptrInt32(desired)},
		Status: appsv1.ReplicaSetStatus{
			Replicas:          desired,
			ReadyReplicas:     ready,
			AvailableReplicas: available,
		},
	}
}

// TestBuildResourceModelStatus covers the ReplicaSet status presentation that
// moved here with the model (was a case in resourcemodel's workload status test).
func TestBuildResourceModelStatus(t *testing.T) {
	model := replicaset.BuildResourceModel("cluster-a", replicaSetWithReplicas(3, 0, 0))
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "apps", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "ReplicaSet", model.Ref.Kind)
	require.Equal(t, "replicasets", model.Ref.Resource)
	require.Equal(t, "default", model.Ref.Namespace)
	require.Equal(t, "replica", model.Ref.Name)
	require.Equal(t, "0/3", model.Status.State)
	require.Equal(t, "Updating", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)
}
