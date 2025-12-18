package snapshot

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type fakePodMetricsProvider struct {
	usage    map[string]metrics.PodUsage
	metadata metrics.Metadata
}

func (f fakePodMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	return map[string]metrics.NodeUsage{}
}

func (f fakePodMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	out := make(map[string]metrics.PodUsage, len(f.usage))
	for k, v := range f.usage {
		out[k] = v
	}
	return out
}

func (f fakePodMetricsProvider) Metadata() metrics.Metadata {
	return f.metadata
}

func TestPodBuilderNodeScope(t *testing.T) {
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-a",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
			ResourceVersion:   "11",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "rs-a",
				Controller: boolPtr(true),
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name: "c1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("100m"),
						corev1.ResourceMemory: resourceQuantity("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("200m"),
						corev1.ResourceMemory: resourceQuantity("256Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "c1",
				Ready:        true,
				RestartCount: 1,
			}},
		},
	}

	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-b",
			Namespace:         "kube-system",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-30 * time.Minute)),
			ResourceVersion:   "15",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name:      "c1",
				Resources: corev1.ResourceRequirements{},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "rs-a",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "deploy-a",
				Controller: boolPtr(true),
			}},
		},
		Spec: appsv1.ReplicaSetSpec{},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, podA, podB),
		rsLister:  testsupport.NewReplicaSetLister(t, rs),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"default/pod-a": {
					CPUUsageMilli:    150,
					MemoryUsageBytes: 196 * 1024 * 1024,
				},
			},
			metadata: metrics.Metadata{
				CollectedAt:         time.Now().Add(-10 * time.Second),
				SuccessCount:        5,
				FailureCount:        1,
				LastError:           "",
				ConsecutiveFailures: 0,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "node:node-1")
	require.NoError(t, err)
	require.Equal(t, podDomainName, snapshot.Domain)
	require.Equal(t, "node:node-1", snapshot.Scope)
	require.Equal(t, uint64(15), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Pods, 2)

	first := payload.Pods[0]
	require.Equal(t, "pod-a", first.Name)
	require.Equal(t, "Deployment", first.OwnerKind)
	require.Equal(t, "deploy-a", first.OwnerName)
	require.Equal(t, "150m", first.CPUUsage)
	require.Equal(t, "196 MB", first.MemUsage)
	require.True(t, strings.HasPrefix(first.Ready, "1/"))

	require.False(t, payload.Metrics.Stale)
	require.Equal(t, uint64(5), payload.Metrics.SuccessCount)
	require.Equal(t, uint64(1), payload.Metrics.FailureCount)
}

func TestPodBuilderWorkloadScope(t *testing.T) {
	owner := boolPtr(true)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-workload",
			Namespace:         "prod",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour)),
			ResourceVersion:   "7",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "rs-workload",
				Controller: owner,
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-x",
			Containers: []corev1.Container{{
				Name:      "c1",
				Resources: corev1.ResourceRequirements{},
			}},
		},
	}
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "rs-workload",
			Namespace: "prod",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "orders",
				Controller: owner,
			}},
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pod),
		rsLister:  testsupport.NewReplicaSetLister(t, rs),
		metrics:   fakePodMetricsProvider{},
	}

	snapshot, err := builder.Build(context.Background(), "workload:prod:Deployment:orders")
	require.NoError(t, err)
	require.Equal(t, uint64(7), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Pods, 1)
	require.Equal(t, "pod-workload", payload.Pods[0].Name)
	require.Equal(t, "Deployment", payload.Pods[0].OwnerKind)
	require.Equal(t, "orders", payload.Pods[0].OwnerName)
}

func TestPodBuilderNamespaceScope(t *testing.T) {
	now := time.Now()
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "team-a-pod-1",
			Namespace:         "team-a",
			ResourceVersion:   "101",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "web",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("50m"),
						corev1.ResourceMemory: resourceQuantity("64Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "web",
				Ready:        true,
				RestartCount: 0,
			}},
		},
	}

	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "team-a-pod-2",
			Namespace:         "team-a",
			ResourceVersion:   "95",
			CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "worker",
				Resources: corev1.ResourceRequirements{
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("150m"),
						corev1.ResourceMemory: resourceQuantity("128Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, podA, podB),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"team-a/team-a-pod-1": {
					CPUUsageMilli:    25,
					MemoryUsageBytes: 32 * 1024 * 1024,
				},
			},
			metadata: metrics.Metadata{
				CollectedAt: now,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, podDomainName, snapshot.Domain)
	require.Equal(t, "namespace:team-a", snapshot.Scope)
	// Highest resource version between pods (101)
	require.Equal(t, uint64(101), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Pods, 2)
	require.Equal(t, "team-a", payload.Pods[0].Namespace)
	require.Equal(t, "team-a-pod-1", payload.Pods[0].Name)
	require.Equal(t, "25m", payload.Pods[0].CPUUsage)
	require.Equal(t, "32 MB", payload.Pods[0].MemUsage)
	require.Equal(t, "team-a-pod-2", payload.Pods[1].Name)
}

func TestPodBuilderAllNamespacesScope(t *testing.T) {
	now := time.Now()
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "alpha",
			Namespace:         "team-a",
			ResourceVersion:   "20",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
	}
	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "bravo",
			Namespace:         "team-b",
			ResourceVersion:   "25",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, podA, podB),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{},
			metadata: metrics.Metadata{
				CollectedAt: now,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, podDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)
	require.Equal(t, uint64(25), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Pods, 2)
	require.Equal(t, []string{"team-a", "team-b"}, []string{payload.Pods[0].Namespace, payload.Pods[1].Namespace})
}

func boolPtr(v bool) *bool {
	return &v
}

func resourceQuantity(value string) resource.Quantity {
	return resource.MustParse(value)
}
