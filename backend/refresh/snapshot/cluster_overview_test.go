package snapshot

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	kubefake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type fakeClusterMetrics struct {
	pods map[string]metrics.PodUsage
	meta metrics.Metadata
}

func (f fakeClusterMetrics) LatestNodeUsage() map[string]metrics.NodeUsage {
	return map[string]metrics.NodeUsage{}
}

func (f fakeClusterMetrics) LatestPodUsage() map[string]metrics.PodUsage {
	out := make(map[string]metrics.PodUsage, len(f.pods))
	for k, v := range f.pods {
		out[k] = v
	}
	return out
}

func (f fakeClusterMetrics) Metadata() metrics.Metadata {
	return f.meta
}

func TestClusterOverviewBuilder(t *testing.T) {
	now := time.Now()

	nodeFargate := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "fargate-node",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
			Labels: map[string]string{
				"eks.amazonaws.com/compute-type": "fargate",
				"eks.amazonaws.com/nodegroup":    "ng-1",
			},
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("500m"),
				corev1.ResourceMemory: resource.MustParse("1Gi"),
			},
		},
	}

	nodeEC2 := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "ec2-node",
			ResourceVersion:   "12",
			CreationTimestamp: metav1.NewTime(now.Add(-4 * time.Hour)),
			Labels: map[string]string{
				"eks.amazonaws.com/nodegroup": "ng-2",
			},
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("2000m"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
		},
	}

	podRunning := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "run-a",
			Namespace:       "default",
			ResourceVersion: "20",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "c1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}

	podPending := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pending-b",
			Namespace:       "kube-system",
			ResourceVersion: "22",
		},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{
				Name: "init",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("64Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodPending},
	}

	nsA := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "default",
			ResourceVersion: "30",
		},
	}
	nsB := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "kube-system",
			ResourceVersion: "31",
		},
	}
	builder := &ClusterOverviewBuilder{
		client:          nil,
		nodeLister:      testsupport.NewNodeLister(t, nodeFargate, nodeEC2),
		podLister:       testsupport.NewPodLister(t, podRunning, podPending),
		namespaceLister: testsupport.NewNamespaceLister(t, nsA, nsB),
		metrics: fakeClusterMetrics{
			pods: map[string]metrics.PodUsage{
				"default/run-a": {
					CPUUsageMilli:    150,
					MemoryUsageBytes: 200 * 1024 * 1024,
				},
			},
			meta: metrics.Metadata{
				CollectedAt:         now.Add(-5 * time.Second),
				SuccessCount:        3,
				FailureCount:        1,
				ConsecutiveFailures: 0,
			},
		},
		cachedVersion:  "v1.29.3-eks-a1b2c3",
		versionFetched: now,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterOverviewDomainName, snapshot.Domain)
	require.Equal(t, uint64(31), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)

	overview := payload.Overview
	require.Equal(t, "EKS", overview.ClusterType)
	require.Equal(t, "v1.29.3-eks-a1b2c3", overview.ClusterVersion)
	require.Equal(t, 2, overview.TotalNodes)
	require.Equal(t, 1, overview.FargateNodes)
	require.Equal(t, 1, overview.EC2Nodes)
	require.Equal(t, 0, overview.RegularNodes)
	require.Equal(t, 0, overview.VirtualNodes)
	require.Equal(t, 0, overview.VMNodes)
	require.Equal(t, 2, overview.TotalPods)
	require.Equal(t, 1, overview.RunningPods)
	require.Equal(t, 1, overview.PendingPods)
	require.Equal(t, 0, overview.FailedPods)
	require.Equal(t, 2, overview.TotalNamespaces)
	require.Equal(t, "150m", overview.CPUUsage)
	require.Equal(t, "350m", overview.CPURequests)
	require.Equal(t, "500m", overview.CPULimits)
	require.Equal(t, "2.50", overview.CPUAllocatable)
	require.Equal(t, "200.0 Mi", overview.MemoryUsage)
	require.Equal(t, "320.0 Mi", overview.MemoryRequests)
	require.Equal(t, "512.0 Mi", overview.MemoryLimits)
	require.Equal(t, "9.0 Gi", overview.MemoryAllocatable)

	metricsMeta := payload.Metrics
	require.False(t, metricsMeta.Stale)
	require.Greater(t, metricsMeta.CollectedAt, int64(0))
	require.Equal(t, uint64(3), metricsMeta.SuccessCount)
	require.Equal(t, uint64(1), metricsMeta.FailureCount)

	require.Equal(t, overview.TotalNodes, snapshot.Stats.ItemCount)
}

func TestClusterOverviewBuilderAggregatesWorkloadResourceUsage(t *testing.T) {
	now := time.Now()
	controller := true

	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-7c8d9",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "api",
				Controller: &controller,
			}},
		},
	}
	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-7c8d9-a",
				Namespace: "default",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "ReplicaSet",
					Name:       "api-7c8d9",
					Controller: &controller,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "agent-a",
				Namespace: "kube-system",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "DaemonSet",
					Name:       "agent",
					Controller: &controller,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "db-0",
				Namespace: "default",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "StatefulSet",
					Name:       "db",
					Controller: &controller,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "batch-a",
				Namespace: "default",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "Job",
					Name:       "batch",
					Controller: &controller,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "standalone",
				Namespace: "default",
			},
		},
	}

	builder := &ClusterOverviewBuilder{
		nodeLister:       testsupport.NewNodeLister(t),
		podLister:        testsupport.NewPodLister(t, pods...),
		namespaceLister:  testsupport.NewNamespaceLister(t),
		replicaSetLister: testsupport.NewReplicaSetLister(t, replicaSet),
		cachedVersion:    "v1.30.0",
		versionFetched:   now,
		replicaSetHasSynced: func() bool {
			return true
		},
		metrics: fakeClusterMetrics{
			pods: map[string]metrics.PodUsage{
				"default/api-7c8d9-a": {
					CPUUsageMilli:    250,
					MemoryUsageBytes: 300 * 1024 * 1024,
				},
				"kube-system/agent-a": {
					CPUUsageMilli:    50,
					MemoryUsageBytes: 100 * 1024 * 1024,
				},
				"default/db-0": {
					CPUUsageMilli:    75,
					MemoryUsageBytes: 120 * 1024 * 1024,
				},
				"default/batch-a": {
					CPUUsageMilli:    125,
					MemoryUsageBytes: 256 * 1024 * 1024,
				},
				"default/standalone": {
					CPUUsageMilli:    900,
					MemoryUsageBytes: 900 * 1024 * 1024,
				},
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)

	usage := payload.Overview.WorkloadResourceUsage
	require.Equal(t, WorkloadTypeResourceUsage{CPUUsage: "250m", MemoryUsage: "300.0 Mi"}, usage.Deployments)
	require.Equal(t, WorkloadTypeResourceUsage{CPUUsage: "50m", MemoryUsage: "100.0 Mi"}, usage.DaemonSets)
	require.Equal(t, WorkloadTypeResourceUsage{CPUUsage: "75m", MemoryUsage: "120.0 Mi"}, usage.StatefulSets)
	require.Equal(t, WorkloadTypeResourceUsage{CPUUsage: "125m", MemoryUsage: "256.0 Mi"}, usage.Jobs)
}

func TestClusterOverviewBuilderUsesCatalog(t *testing.T) {
	now := time.Now()

	nodes := []*corev1.Node{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "node-a",
				ResourceVersion:   "5",
				CreationTimestamp: metav1.NewTime(now.Add(-3 * time.Hour)),
			},
			Status: corev1.NodeStatus{
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("1000m"),
					corev1.ResourceMemory: resource.MustParse("4Gi"),
				},
			},
		},
	}
	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "pod-a",
				Namespace:       "default",
				ResourceVersion: "9",
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{
					Name: "c1",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("200m"),
							corev1.ResourceMemory: resource.MustParse("256Mi"),
						},
					},
				}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				ContainerStatuses: []corev1.ContainerStatus{{
					Name: "c1",
				}},
			},
		},
	}
	namespaces := []*corev1.Namespace{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "default",
				ResourceVersion:   "2",
				CreationTimestamp: metav1.NewTime(now.Add(-24 * time.Hour)),
			},
		},
	}

	builder := &ClusterOverviewBuilder{
		nodeLister:      testsupport.NewNodeLister(t, nodes...),
		podLister:       testsupport.NewPodLister(t, pods...),
		namespaceLister: testsupport.NewNamespaceLister(t, namespaces...),
		metrics: fakeClusterMetrics{
			pods: map[string]metrics.PodUsage{
				"default/pod-a": {
					CPUUsageMilli:    100,
					MemoryUsageBytes: 128 * 1024 * 1024,
				},
			},
		},
		cachedVersion:  "v1.28.1",
		versionFetched: now,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterOverviewDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)

	require.Equal(t, 1, payload.Overview.TotalNodes)
	require.Equal(t, 1, payload.Overview.TotalPods)
	require.Equal(t, 1, payload.Overview.TotalNamespaces)
	require.Equal(t, "v1.28.1", payload.Overview.ClusterVersion)
	require.Equal(t, "100m", payload.Overview.CPUUsage)
	require.Equal(t, "200m", payload.Overview.CPURequests)
	require.Equal(t, "256.0 Mi", payload.Overview.MemoryRequests)
	require.Equal(t, "128.0 Mi", payload.Overview.MemoryUsage)
}

func TestClusterOverviewBuilderSkipsOptionalCachesUntilSynced(t *testing.T) {
	now := time.Now()

	builder := &ClusterOverviewBuilder{
		nodeLister:      testsupport.NewNodeLister(t, &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}}),
		podLister:       testsupport.NewPodLister(t),
		namespaceLister: testsupport.NewNamespaceLister(t),
		eventLister: testsupport.NewEventLister(t, &corev1.Event{
			ObjectMeta: metav1.ObjectMeta{Name: "warn-a", Namespace: "default", UID: "event-1"},
			Type:       corev1.EventTypeWarning,
			LastTimestamp: metav1.Time{
				Time: now,
			},
			InvolvedObject: corev1.ObjectReference{
				Kind:       "Pod",
				Name:       "api-a",
				Namespace:  "default",
				APIVersion: "v1",
				UID:        "pod-uid-1",
			},
		}),
		deploymentLister:  testsupport.NewDeploymentLister(t, &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "deploy-a", Namespace: "default"}}),
		statefulSetLister: testsupport.NewStatefulSetLister(t, &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "stateful-a", Namespace: "default"}}),
		daemonSetLister:   testsupport.NewDaemonSetLister(t, &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "daemon-a", Namespace: "default"}}),
		cronJobLister:     testsupport.NewCronJobLister(t, &batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "cron-a", Namespace: "default"}}),
		hasSyncedFns: []cache.InformerSynced{
			func() bool { return true },
			func() bool { return true },
			func() bool { return true },
		},
		eventHasSynced:       func() bool { return false },
		deploymentHasSynced:  func() bool { return false },
		statefulSetHasSynced: func() bool { return false },
		daemonSetHasSynced:   func() bool { return false },
		cronJobHasSynced:     func() bool { return false },
		cachedVersion:        "v1.29.0",
		versionFetched:       now,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)
	require.Zero(t, payload.Overview.TotalDeployments)
	require.Zero(t, payload.Overview.TotalStatefulSets)
	require.Zero(t, payload.Overview.TotalDaemonSets)
	require.Zero(t, payload.Overview.TotalCronJobs)
	require.Empty(t, payload.Overview.RecentEvents)
}

func TestClusterOverviewListBuilderIncludesOptionalCountsAndRecentEvents(t *testing.T) {
	now := time.Now()

	client := kubefake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default"},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning},
		},
		&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "deploy-a", Namespace: "default"}},
		&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "stateful-a", Namespace: "default"}},
		&appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "daemon-a", Namespace: "default"}},
		&batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "cron-a", Namespace: "default"}},
		&corev1.Event{
			ObjectMeta: metav1.ObjectMeta{Name: "warn-a", Namespace: "default", UID: "event-1"},
			Type:       corev1.EventTypeWarning,
			LastTimestamp: metav1.Time{
				Time: now,
			},
			InvolvedObject: corev1.ObjectReference{
				Kind:       "Pod",
				Name:       "pod-a",
				Namespace:  "default",
				APIVersion: "v1",
				UID:        "pod-uid-1",
			},
			Message: "Back-off restarting failed container",
			Reason:  "BackOff",
		},
	)

	builder := &ClusterOverviewListBuilder{
		client:     client,
		metrics:    fakeClusterMetrics{},
		versionFn:  func(context.Context) string { return "v1.30.0" },
		serverHost: "https://cluster.example.com",
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)
	require.Equal(t, 1, payload.Overview.TotalDeployments)
	require.Equal(t, 1, payload.Overview.TotalStatefulSets)
	require.Equal(t, 1, payload.Overview.TotalDaemonSets)
	require.Equal(t, 1, payload.Overview.TotalCronJobs)
	require.Len(t, payload.Overview.RecentEvents, 1)
	require.Equal(t, "event-1", payload.Overview.RecentEvents[0].EventUID)
	require.Equal(t, "pod-uid-1", payload.Overview.RecentEvents[0].ObjectUID)
}

func TestClusterOverviewListBuilderIgnoresForbiddenOptionalResources(t *testing.T) {
	client := kubefake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
	)
	for _, resource := range []struct {
		group    string
		resource string
	}{
		{group: "apps", resource: "deployments"},
		{group: "apps", resource: "replicasets"},
		{group: "apps", resource: "statefulsets"},
		{group: "apps", resource: "daemonsets"},
		{group: "batch", resource: "cronjobs"},
		{group: "", resource: "events"},
	} {
		resource := resource
		client.PrependReactor("list", resource.resource, func(cgotesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(
				schema.GroupResource{Group: resource.group, Resource: resource.resource},
				resource.resource,
				errors.New("forbidden"),
			)
		})
	}

	builder := &ClusterOverviewListBuilder{
		client:     client,
		metrics:    fakeClusterMetrics{},
		versionFn:  func(context.Context) string { return "v1.30.0" },
		serverHost: "https://cluster.example.com",
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)
	require.Zero(t, payload.Overview.TotalDeployments)
	require.Zero(t, payload.Overview.TotalStatefulSets)
	require.Zero(t, payload.Overview.TotalDaemonSets)
	require.Zero(t, payload.Overview.TotalCronJobs)
	require.Empty(t, payload.Overview.RecentEvents)
}

func TestDetectClusterTypeFallsBackToServerHostForAKS(t *testing.T) {
	require.Equal(t, "AKS", detectClusterType("Unknown", "https://mycluster.azmk8s.io"))
	require.Equal(t, "AKS", detectClusterType("", "https://FOO.AZMK8S.IO"))
	require.Equal(t, "AKS", detectClusterType("v1.29.3", "https://foo.azmk8s.io"))
	require.Equal(t, "Unmanaged", detectClusterType("Unknown", "https://example.com"))
}

func TestDetectClusterTypePrefersVersionWhenPresent(t *testing.T) {
	require.Equal(t, "EKS", detectClusterType("v1.28.3-eks-b1234", "https://mycluster.azmk8s.io"))
}

// TestClusterOverviewAKSVirtualNodes verifies that AKS clusters categorize
// nodes with the type=virtual-kubelet label as virtual nodes and count the
// remainder as VM nodes.
func TestClusterOverviewAKSVirtualNodes(t *testing.T) {
	now := time.Now()

	nodeVM := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "aks-nodepool1-12345678-vmss000000",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("2000m"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
		},
	}

	nodeVirtual := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "virtual-node-aci-linux",
			ResourceVersion:   "11",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
			Labels: map[string]string{
				"type": "virtual-kubelet",
			},
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("10000m"),
				corev1.ResourceMemory: resource.MustParse("100Gi"),
			},
		},
	}

	builder := &ClusterOverviewBuilder{
		nodeLister:      testsupport.NewNodeLister(t, nodeVM, nodeVirtual),
		podLister:       testsupport.NewPodLister(t),
		namespaceLister: testsupport.NewNamespaceLister(t),
		metrics:         fakeClusterMetrics{},
		cachedVersion:   "v1.29.0",
		versionFetched:  now,
		serverHost:      "https://mycluster.azmk8s.io",
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)

	overview := payload.Overview
	require.Equal(t, "AKS", overview.ClusterType)
	require.Equal(t, 2, overview.TotalNodes)
	require.Equal(t, 1, overview.VirtualNodes)
	require.Equal(t, 1, overview.VMNodes)
	// EKS- and generic-only fields should be zero for AKS.
	require.Equal(t, 0, overview.FargateNodes)
	require.Equal(t, 0, overview.EC2Nodes)
	require.Equal(t, 0, overview.RegularNodes)
}

// TestClusterOverviewGKEShowsOnlyTotal verifies that GKE clusters only
// populate TotalNodes (no provider-specific breakdown).
func TestClusterOverviewGKEShowsOnlyTotal(t *testing.T) {
	now := time.Now()

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "gke-pool-1-abc123",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("2000m"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
		},
	}

	builder := &ClusterOverviewBuilder{
		nodeLister:      testsupport.NewNodeLister(t, node),
		podLister:       testsupport.NewPodLister(t),
		namespaceLister: testsupport.NewNamespaceLister(t),
		metrics:         fakeClusterMetrics{},
		cachedVersion:   "v1.29.0-gke.1234",
		versionFetched:  now,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)

	overview := payload.Overview
	require.Equal(t, "GKE", overview.ClusterType)
	require.Equal(t, 1, overview.TotalNodes)
	// GKE nodes are counted as regular; the frontend does not display this breakdown.
	require.Equal(t, 1, overview.RegularNodes)
	// Provider-specific fields should be zero for GKE.
	require.Equal(t, 0, overview.FargateNodes)
	require.Equal(t, 0, overview.EC2Nodes)
	require.Equal(t, 0, overview.VirtualNodes)
	require.Equal(t, 0, overview.VMNodes)
}

func TestClusterOverviewSuppressesInitialMetricsErrors(t *testing.T) {
	builder := &ClusterOverviewBuilder{
		nodeLister:      testsupport.NewNodeLister(t),
		podLister:       testsupport.NewPodLister(t),
		namespaceLister: testsupport.NewNamespaceLister(t),
		metrics: fakeClusterMetrics{
			meta: metrics.Metadata{
				LastError:           "metrics API unavailable (pods.metrics.k8s.io)",
				FailureCount:        1,
				ConsecutiveFailures: 1,
				SuccessCount:        0,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)
	require.Equal(t, "", payload.Metrics.LastError)
	require.False(t, payload.Metrics.Stale)
	require.Equal(t, uint64(1), payload.Metrics.FailureCount)
	require.Equal(t, uint64(0), payload.Metrics.SuccessCount)
}

func TestClusterOverviewSurfacesRepeatedMetricsErrors(t *testing.T) {
	builder := &ClusterOverviewBuilder{
		nodeLister:      testsupport.NewNodeLister(t),
		podLister:       testsupport.NewPodLister(t),
		namespaceLister: testsupport.NewNamespaceLister(t),
		metrics: fakeClusterMetrics{
			meta: metrics.Metadata{
				LastError:           "metrics API unavailable (pods.metrics.k8s.io)",
				FailureCount:        5,
				ConsecutiveFailures: 5,
				SuccessCount:        0,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	require.True(t, ok)
	require.Equal(t, "metrics API unavailable (pods.metrics.k8s.io)", payload.Metrics.LastError)
	require.False(t, payload.Metrics.Stale)
	require.Equal(t, uint64(5), payload.Metrics.FailureCount)
	require.Equal(t, uint64(0), payload.Metrics.SuccessCount)
}
