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

type fakeMetricsProvider struct {
	usage    map[string]metrics.NodeUsage
	podUsage map[string]metrics.PodUsage
	metadata metrics.Metadata
}

func (f fakeMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	out := make(map[string]metrics.NodeUsage, len(f.usage))
	for k, v := range f.usage {
		out[k] = v
	}
	return out
}

func (f fakeMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	out := make(map[string]metrics.PodUsage, len(f.podUsage))
	for k, v := range f.podUsage {
		out[k] = v
	}
	return out
}

func (f fakeMetricsProvider) Metadata() metrics.Metadata {
	return f.metadata
}

func TestNodeBuilderBuild(t *testing.T) {
	collectedAt := time.Now().Add(-30 * time.Second)
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
			ResourceVersion:   "42",
			Labels: map[string]string{
				"node-role.kubernetes.io/control-plane": "",
				"node-role.kubernetes.io/worker":        "",
				"node-role.kubernetes.io/custom":        "",
			},
			Annotations: map[string]string{
				"example": "annotation",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: true,
			Taints: []corev1.Taint{{
				Key:    "node.kubernetes.io/unreachable",
				Effect: corev1.TaintEffectNoSchedule,
			}},
		},
		Status: corev1.NodeStatus{
			NodeInfo: corev1.NodeSystemInfo{
				KubeletVersion: "v1.29.0",
			},
			Addresses: []corev1.NodeAddress{
				{Type: corev1.NodeInternalIP, Address: "10.0.0.5"},
				{Type: corev1.NodeExternalIP, Address: "35.1.1.9"},
			},
			Conditions: []corev1.NodeCondition{{
				Type:   corev1.NodeReady,
				Status: corev1.ConditionTrue,
			}},
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("8"),
				corev1.ResourceMemory: resource.MustParse("32Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("7"),
				corev1.ResourceMemory: resource.MustParse("30Gi"),
				corev1.ResourcePods:   resource.MustParse("100"),
			},
		},
	}

	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-a",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name: "c1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("1Gi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "c1",
				RestartCount: 1,
			}},
		},
	}

	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-b",
			Namespace: "kube-system",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name: "c2",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("700m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "c2",
				RestartCount: 2,
			}},
		},
	}

	podOther := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-c",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-2",
		},
	}

	builder := &NodeBuilder{
		lister:    testsupport.NewNodeLister(t, node),
		podLister: testsupport.NewPodLister(t, podA, podB, podOther),
		metrics: fakeMetricsProvider{
			usage: map[string]metrics.NodeUsage{
				"node-1": {
					CPUUsageMilli:    650,
					MemoryUsageBytes: 512 * 1024 * 1024,
				},
			},
			podUsage: map[string]metrics.PodUsage{
				"default/pod-a": {
					CPUUsageMilli:    125,
					MemoryUsageBytes: 128 * 1024 * 1024,
				},
				"kube-system/pod-b": {
					CPUUsageMilli:    250,
					MemoryUsageBytes: 64 * 1024 * 1024,
				},
			},
			metadata: metrics.Metadata{
				CollectedAt:  collectedAt,
				SuccessCount: 7,
				FailureCount: 2,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.NotNil(t, snapshot)

	payload, ok := snapshot.Payload.(NodeSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Nodes, 1)

	summary := payload.Nodes[0]

	require.Equal(t, "node-1", summary.Name)
	require.Equal(t, "Ready", summary.Status)
	require.Equal(t, "control-plane,custom,worker", summary.Roles)
	require.Equal(t, "v1.29.0", summary.Version)
	require.Equal(t, "10.0.0.5", summary.InternalIP)
	require.Equal(t, "35.1.1.9", summary.ExternalIP)

	require.Equal(t, "8", summary.CPUCapacity)
	require.Equal(t, "7", summary.CPUAllocatable)
	require.Equal(t, "650m", summary.CPUUsage)
	require.Equal(t, "1200m", summary.CPULimits)
	require.Equal(t, "750m", summary.CPURequests)

	require.Equal(t, "32.0 GB", summary.MemoryCapacity)
	require.Equal(t, "30.0 GB", summary.MemoryAllocatable)
	require.Equal(t, "512 MB", summary.MemoryUsage)
	require.Equal(t, "768 MB", summary.MemRequests)
	require.Equal(t, "1.5 GB", summary.MemLimits)

	require.Equal(t, "2/110", summary.Pods)
	require.Equal(t, "110", summary.PodsCapacity)
	require.Equal(t, "100", summary.PodsAllocatable)
	require.Equal(t, int32(3), summary.Restarts)
	require.Equal(t, "node", summary.Kind)
	require.Equal(t, "8", summary.CPU)
	require.Equal(t, "32.0 GB", summary.Memory)
	require.True(t, summary.Unschedulable)
	require.Len(t, summary.PodMetrics, 2)
	require.Contains(t, summary.PodMetrics, NodePodMetric{
		Namespace:   "default",
		Name:        "pod-a",
		CPUUsage:    "125m",
		MemoryUsage: "128 MB",
	})
	require.Contains(t, summary.PodMetrics, NodePodMetric{
		Namespace:   "kube-system",
		Name:        "pod-b",
		CPUUsage:    "250m",
		MemoryUsage: "64 MB",
	})

	require.False(t, payload.Metrics.Stale)
	require.Equal(t, collectedAt.Unix(), payload.Metrics.CollectedAt)
	require.Equal(t, 0, payload.Metrics.ConsecutiveFailures)
	require.Empty(t, payload.Metrics.LastError)
	require.Equal(t, uint64(7), payload.Metrics.SuccessCount)
	require.Equal(t, uint64(2), payload.Metrics.FailureCount)

	require.Len(t, summary.Taints, 1)
	require.Equal(t, NodeTaint{
		Key:    "node.kubernetes.io/unreachable",
		Effect: string(corev1.TaintEffectNoSchedule),
	}, summary.Taints[0])

	// Ensure maps are deep-copied
	require.Equal(t, "annotation", summary.Annotations["example"])
	node.Annotations["example"] = "mutated"
	require.Equal(t, "annotation", summary.Annotations["example"])

	require.Equal(t, uint64(42), snapshot.Version)
}
