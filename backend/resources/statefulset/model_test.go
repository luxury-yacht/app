package statefulset_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/statefulset"
)

func ptrInt32(v int32) *int32 { return &v }

// TestBuildResourceModelStatus covers the StatefulSet status presentation that
// moved here with the model (was a case in resourcemodel's workload status test).
func TestBuildResourceModelStatus(t *testing.T) {
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec:       appsv1.StatefulSetSpec{Replicas: ptrInt32(3)},
		Status: appsv1.StatefulSetStatus{
			Replicas:          3,
			ReadyReplicas:     1,
			UpdatedReplicas:   2,
			AvailableReplicas: 2,
		},
	}

	model := statefulset.BuildResourceModel("cluster-a", ss)
	require.Equal(t, "1/3", model.Status.State)
	require.Equal(t, "Updating", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)
}
