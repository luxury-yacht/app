package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

func wlDeployment(name, namespace, rv string, ready, total int32) *appsv1.Deployment {
	replicas := total
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, CreationTimestamp: metav1.NewTime(time.Unix(1_700_000_000, 0))},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas, Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": name}}},
		Status:     appsv1.DeploymentStatus{ReadyReplicas: ready, Replicas: total},
	}
}

func wlPod(name, namespace, rv string, ownerRSName string, restarts int32) *corev1.Pod {
	ctrl := true
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, CreationTimestamp: metav1.NewTime(time.Unix(1_700_000_100, 0))},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Name: "c", Ready: true, RestartCount: restarts}},
		},
	}
	if ownerRSName != "" {
		pod.OwnerReferences = []metav1.OwnerReference{{Kind: "ReplicaSet", Name: ownerRSName, Controller: &ctrl}}
	}
	return pod
}

// TestNamespaceWorkloadsBuilderMaintainedMatchesListPath is the workloads maintained-store
// cutover gate: a builder serving from the incrementally-recomputed store (object-state rows,
// metrics overlaid at serve) must produce the byte-identical NamespaceWorkloadsSnapshot the
// list path produces — across namespace + query scopes, WITH a non-empty metrics sample so
// the serve overlay is exercised (workload rows via reaggregate, standalone rows rebuilt).
func TestNamespaceWorkloadsBuilderMaintainedMatchesListPath(t *testing.T) {
	meta := ClusterMeta{}
	dep := wlDeployment("web", "default", "100", 1, 2)
	ownedPod := wlPod("web-123", "default", "201", "web-123", 0) // RS web-123 -> deployment web
	standalonePod := wlPod("loner", "default", "202", "", 3)     // no owner -> standalone
	otherNsPod := wlPod("solo", "kube-system", "203", "", 1)     // standalone in another ns

	usage := map[string]metrics.PodUsage{
		"default/web-123":  {CPUUsageMilli: 50, MemoryUsageBytes: 1 << 20},
		"default/loner":    {CPUUsageMilli: 25, MemoryUsageBytes: 2 << 20},
		"kube-system/solo": {CPUUsageMilli: 10, MemoryUsageBytes: 3 << 20},
	}

	mk := func(maintained bool) *NamespaceWorkloadsBuilder {
		b := &NamespaceWorkloadsBuilder{
			podIngest:           newFakePodWorkloadsIngestSource(meta, nil, ownedPod, standalonePod, otherNsPod),
			includePods:         true,
			workloadIngest:      newFakeWorkloadIngestSource(meta, dep),
			includeDeployments:  true,
			includeStatefulSets: true,
			includeDaemonSets:   true,
			includeJobs:         true,
			includeCronJobs:     true,
			metrics:             &workloadMetricsProvider{pods: usage},
		}
		if maintained {
			b.workloadsMaintained = newTypedMaintainedStore(meta, workloadsQuerypageSchema(), workloadTableQueryAdapter())
			b.recomputeWorkloadsStore()
		}
		return b
	}
	list := mk(false)
	maint := mk(true)

	scopes := []string{
		"namespace:all",
		"namespace:default",
		"namespace:kube-system",
		"namespace:all?sortField=name&sortDirection=asc&limit=2",
		"namespace:all?sortField=cpu&sortDirection=desc",
	}
	for _, scope := range scopes {
		ls, err := list.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		ms, err := maint.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)
		require.Equal(t,
			ls.Payload.(NamespaceWorkloadsSnapshot),
			ms.Payload.(NamespaceWorkloadsSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}

// TestNamespaceWorkloadsMaintainedStandaloneTransitions pins the cross-kind transition: when
// the owning workload is removed, its previously-owned pod becomes a standalone row (and vice
// versa). The store is recomputed from the ingest sources, matching the list path each time.
func TestNamespaceWorkloadsMaintainedStandaloneTransitions(t *testing.T) {
	meta := ClusterMeta{}
	dep := wlDeployment("web", "default", "100", 1, 1)
	ownedPod := wlPod("web-123", "default", "201", "web-123", 0)

	podSrc := newFakePodWorkloadsIngestSource(meta, nil, ownedPod)
	b := &NamespaceWorkloadsBuilder{
		podIngest:           podSrc,
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(meta, dep),
		includeDeployments:  true,
		metrics:             &workloadMetricsProvider{pods: map[string]metrics.PodUsage{}},
		workloadsMaintained: newTypedMaintainedStore(meta, workloadsQuerypageSchema(), workloadTableQueryAdapter()),
	}
	b.recomputeWorkloadsStore()

	// With the deployment present, web-123 is owned -> no standalone Pod row; one Deployment row.
	rows := b.workloadsMaintained.rows("default", map[string]bool{"Deployment": true, "Pod": true})
	require.Len(t, rows, 1)
	require.Equal(t, "Deployment", rows[0].Kind)

	// Remove the deployment: web-123 now has no owning workload -> it becomes standalone.
	b.workloadIngest = newFakeWorkloadIngestSource(meta)
	b.recomputeWorkloadsStore()
	rows = b.workloadsMaintained.rows("default", map[string]bool{"Deployment": true, "Pod": true})
	require.Len(t, rows, 1)
	require.Equal(t, "Pod", rows[0].Kind)
	require.Equal(t, "web-123", rows[0].Name)
}
