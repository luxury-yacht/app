package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestBasePodSnapshotDoesNotReadMetricsProvider(t *testing.T) {
	created := time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(created),
			ResourceVersion:   "17",
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pod),
		rsLister:  testsupport.NewReplicaSetLister(t),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)

	payload := snapshot.Payload.(PodSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[0].MemUsage)
	require.NotContains(t, snapshot.SourceVersions, "metric")
}

func TestBaseNodeSnapshotDoesNotReadMetricsProvider(t *testing.T) {
	created := time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC)
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			CreationTimestamp: metav1.NewTime(created),
			ResourceVersion:   "42",
		},
	}
	builder := newNodeBuilderForTest(
		ClusterMeta{},
		newFakePodAggregateSource(nil).withNodes(ClusterMeta{}, "42", node),
		node,
	)

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload := snapshot.Payload.(NodeSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[0].MemoryUsage)
	require.NotContains(t, snapshot.SourceVersions, "metric")
}

func TestBaseWorkloadSnapshotDoesNotReadMetricsProvider(t *testing.T) {
	created := time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC)
	replicas := int32(1)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(created),
			ResourceVersion:   "21",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)

	payload := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "-", payload.Rows[0].CPUUsage)
	require.Equal(t, "-", payload.Rows[0].MemUsage)
	require.NotContains(t, snapshot.SourceVersions, "metric")
}
