package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

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
	require.Equal(t, 2, overview.TotalPods)
	require.Equal(t, 1, overview.RunningPods)
	require.Equal(t, 1, overview.PendingPods)
	require.Equal(t, 0, overview.FailedPods)
	require.Equal(t, 2, overview.TotalNamespaces)
	require.Equal(t, "150m", overview.CPUUsage)
	require.Equal(t, "350m", overview.CPURequests)
	require.Equal(t, "500m", overview.CPULimits)
	require.Equal(t, "2.50", overview.CPUAllocatable)
	require.Equal(t, "200.0Mi", overview.MemoryUsage)
	require.Equal(t, "320.0Mi", overview.MemoryRequests)
	require.Equal(t, "512.0Mi", overview.MemoryLimits)
	require.Equal(t, "9.0Gi", overview.MemoryAllocatable)

	metricsMeta := payload.Metrics
	require.False(t, metricsMeta.Stale)
	require.Greater(t, metricsMeta.CollectedAt, int64(0))
	require.Equal(t, uint64(3), metricsMeta.SuccessCount)
	require.Equal(t, uint64(1), metricsMeta.FailureCount)

	require.Equal(t, overview.TotalNodes, snapshot.Stats.ItemCount)
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
	require.Equal(t, "256.0Mi", payload.Overview.MemoryRequests)
	require.Equal(t, "128.0Mi", payload.Overview.MemoryUsage)
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
