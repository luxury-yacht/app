package snapshot

import (
	"fmt"
	"math"
	"runtime"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// BenchmarkPodIngestStoreRetainedHeap reports the heap the pod ingest store
// retains per pod after a relist, with and without the owner-key index, at a
// 10,000-pod cluster with a mixed owner shape: replicated Deployments,
// DaemonSets, StatefulSets, one-pod Jobs, and standalone pods. The source Pods
// are dropped before measuring, as the reflector drops them, so strings the
// projection shares with a Pod count toward the store. Each variant reports
// its lowest B/pod across iterations to damp unrelated heap noise.
//
//	go test ./backend/refresh/snapshot -run '^$' -bench BenchmarkPodIngestStoreRetainedHeap -benchtime=5x
func BenchmarkPodIngestStoreRetainedHeap(b *testing.B) {
	const podCount = 10_000
	for _, variant := range []struct {
		name    string
		indexed bool
	}{{"owner-index", true}, {"no-index", false}} {
		b.Run(variant.name, func(b *testing.B) {
			best := math.MaxFloat64
			for b.Loop() {
				best = min(best, podStoreRetainedBytesPerPod(b, podCount, variant.indexed))
			}
			b.ReportMetric(best, "B/pod")
		})
	}
}

func podStoreRetainedBytesPerPod(b *testing.B, podCount int, indexed bool) float64 {
	b.Helper()
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	store := retainedHeapPodStore(indexed)
	if err := store.Replace(retainedHeapPods(podCount), "1"); err != nil {
		b.Fatal(err)
	}

	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	if got := len(store.ListKeys()); got != podCount {
		b.Fatalf("store holds %d pods, want %d", got, podCount)
	}
	runtime.KeepAlive(store)
	return float64(int64(after.HeapAlloc)-int64(before.HeapAlloc)) / float64(podCount)
}

// retainedHeapPodStore builds the pod store as registerPodReflector configures
// it (the production projector, Table half retained, owner-key index); the
// unindexed variant skips the index so the difference is the index's cost.
func retainedHeapPodStore(indexed bool) *ingest.ProjectingStore {
	store := ingest.NewProjectingStore(NewPodIngestProjector(
		ClusterMeta{ClusterID: "bench", ClusterName: "bench"},
		PodOwnerSources{ReplicaSetOwner: retainedHeapReplicaSetOwner},
	))
	store.SetRetainTable(true)
	if indexed {
		store.AddIndex(PodOwnerKeyIndexName, PodOwnerKeyIndexValues)
	}
	return store
}

// retainedHeapReplicaSetOwner resolves every fixture ReplicaSet to its
// Deployment, as a synced ReplicaSet owner index does.
func retainedHeapReplicaSetOwner(_, name string) (metav1.OwnerReference, bool) {
	deployment := deploymentNameFromReplicaSet(name)
	if deployment == "" {
		return metav1.OwnerReference{}, false
	}
	return metav1.OwnerReference{APIVersion: "apps/v1", Kind: "Deployment", Name: deployment, Controller: ptrBool(true)}, true
}

// retainedHeapOwner is one controller in the fixture and how many pods it runs.
type retainedHeapOwner struct {
	namespace  string
	apiVersion string
	kind       string
	name       string
	replicas   int
}

// retainedHeapOwners lays out podCount pods: 16% across 8 DaemonSets, then
// repeating blocks of 23 three-replica Deployments, one five-replica
// StatefulSet, seven one-pod Jobs, and three standalone pods (empty kind).
func retainedHeapOwners(podCount int) []retainedHeapOwner {
	const daemonSets = 8
	perDaemonSet := podCount * 16 / 100 / daemonSets
	owners := make([]retainedHeapOwner, 0, podCount/2)
	for i := 0; i < daemonSets; i++ {
		owners = append(owners, retainedHeapOwner{"kube-system", "apps/v1", "DaemonSet", fmt.Sprintf("agent-%d", i), perDaemonSet})
	}
	remaining := podCount - daemonSets*perDaemonSet
	for block := 0; remaining > 0; block++ {
		namespace := fmt.Sprintf("team-%02d", block%40)
		blockOwners := make([]retainedHeapOwner, 0, 34)
		for i := 0; i < 23; i++ {
			blockOwners = append(blockOwners, retainedHeapOwner{namespace, "apps/v1", "ReplicaSet", fmt.Sprintf("svc-%d-%d-7d9c8b6f5", block, i), 3})
		}
		blockOwners = append(blockOwners, retainedHeapOwner{namespace, "apps/v1", "StatefulSet", fmt.Sprintf("db-%d", block), 5})
		for i := 0; i < 7; i++ {
			blockOwners = append(blockOwners, retainedHeapOwner{namespace, "batch/v1", "Job", fmt.Sprintf("report-%d-%d-29345678", block, i), 1})
		}
		for i := 0; i < 3; i++ {
			blockOwners = append(blockOwners, retainedHeapOwner{namespace, "", "", fmt.Sprintf("debug-%d-%d", block, i), 1})
		}
		for _, owner := range blockOwners {
			owner.replicas = min(owner.replicas, remaining)
			if owner.replicas == 0 {
				break
			}
			owners = append(owners, owner)
			remaining -= owner.replicas
		}
	}
	return owners
}

func retainedHeapPods(podCount int) []interface{} {
	created := metav1.NewTime(time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	pods := make([]interface{}, 0, podCount)
	for _, owner := range retainedHeapOwners(podCount) {
		for replica := 0; replica < owner.replicas; replica++ {
			pods = append(pods, retainedHeapPod(owner, replica, len(pods), created))
		}
	}
	return pods
}

func retainedHeapPod(owner retainedHeapOwner, replica, index int, created metav1.Time) *corev1.Pod {
	name := owner.name
	if owner.kind != "" {
		name = fmt.Sprintf("%s-%05x", owner.name, replica)
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         owner.namespace,
			Name:              name,
			UID:               types.UID(fmt.Sprintf("00000000-0000-4000-8000-%012d", index)),
			ResourceVersion:   fmt.Sprintf("%d", 100000+index),
			CreationTimestamp: created,
			Labels:            map[string]string{"app.kubernetes.io/name": owner.name, "app.kubernetes.io/part-of": owner.namespace, "pod-template-hash": "7d9c8b6f5"},
			Annotations:       map[string]string{"kubectl.kubernetes.io/default-container": "app"},
		},
		Spec: corev1.PodSpec{
			NodeName:           fmt.Sprintf("ip-10-0-%d-%d.ec2.internal", index%16, index%200),
			ServiceAccountName: "default",
			PriorityClassName:  "standard",
			Containers: []corev1.Container{
				retainedHeapContainer("app", "registry.example.com/team/app:v1.42.0", "250m", "512Mi"),
				retainedHeapContainer("proxy", "registry.example.com/mesh/proxy:v1.20.3", "50m", "64Mi"),
			},
			Volumes: []corev1.Volume{
				{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: owner.name + "-config"}}}},
				{Name: "token", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: owner.name + "-token"}}},
			},
		},
		Status: corev1.PodStatus{
			Phase:     corev1.PodRunning,
			PodIP:     fmt.Sprintf("10.1.%d.%d", index/250%250, index%250),
			HostIP:    fmt.Sprintf("10.0.%d.%d", index%16, index%200),
			StartTime: &created,
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue, LastTransitionTime: created},
				{Type: corev1.ContainersReady, Status: corev1.ConditionTrue, LastTransitionTime: created},
			},
			ContainerStatuses: []corev1.ContainerStatus{
				{Name: "app", Ready: true, RestartCount: int32(index % 3), State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: created}}},
				{Name: "proxy", Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: created}}},
			},
		},
	}
	if owner.kind != "" {
		pod.OwnerReferences = []metav1.OwnerReference{{APIVersion: owner.apiVersion, Kind: owner.kind, Name: owner.name, Controller: ptrBool(true)}}
	}
	return pod
}

func retainedHeapContainer(name, image, cpu, memory string) corev1.Container {
	return corev1.Container{
		Name:  name,
		Image: image,
		Ports: []corev1.ContainerPort{{ContainerPort: 8080, Protocol: corev1.ProtocolTCP}},
		Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceCPU: resourceQuantity(cpu), corev1.ResourceMemory: resourceQuantity(memory)},
			Limits:   corev1.ResourceList{corev1.ResourceMemory: resourceQuantity(memory)},
		},
	}
}
