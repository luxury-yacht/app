package snapshot

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestObjectMapBuildsRecursiveCoreRelationships(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "default:apps/v1:Deployment:web?maxDepth=5&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "apps" || payload.Seed.Version != "v1" || payload.Seed.Kind != "Deployment" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	for _, node := range payload.Nodes {
		if node.Ref.ClusterID == "" || node.Ref.Version == "" || node.Ref.Kind == "" || node.Ref.Name == "" {
			t.Fatalf("node identity is incomplete: %#v", node)
		}
	}
	if got := nodeByKindName(t, payload, "Deployment", "web").CreationTimestamp; got != "2024-01-02T03:04:05Z" {
		t.Fatalf("unexpected creation timestamp for deployment node: %q", got)
	}
	if status := nodeByKindName(t, payload, "Deployment", "web").Status; status == nil || status.State != "2/2" || status.Label != "Running" || status.Presentation != "ready" {
		t.Fatalf("unexpected deployment status: %#v", status)
	}
	if status := nodeByKindName(t, payload, "ConfigMap", "app-config").Status; status == nil || status.State != "2" || status.Label != "2 items" || status.Presentation != "ready" {
		t.Fatalf("unexpected configmap status: %#v", status)
	}
	if status := nodeByKindName(t, payload, "Secret", "app-secret").Status; status == nil || status.State != "Opaque" || status.Label != "Opaque, 1 key" || status.Presentation != "ready" {
		t.Fatalf("unexpected secret status: %#v", status)
	}
	if status := nodeByKindName(t, payload, "PodDisruptionBudget", "web").Status; status == nil || status.State != "1" || status.Label != "MinAvailable: 1, Disruptions Allowed: 1" || status.Presentation != "ready" {
		t.Fatalf("unexpected poddisruptionbudget status: %#v", status)
	}
	if status := nodeByKindName(t, payload, "NetworkPolicy", "web").Status; status == nil || status.State != "1/0" || status.Label != "Ingress, 1 ingress, 0 egress" || status.Presentation != "ready" {
		t.Fatalf("unexpected networkpolicy status: %#v", status)
	}

	assertEdge(t, payload, "Deployment", "web", "ReplicaSet", "web-rs", "owner")
	assertEdge(t, payload, "ReplicaSet", "web-rs", "Pod", "web-pod", "owner")
	assertEdge(t, payload, "PodDisruptionBudget", "web", "Pod", "web-pod", "selector")
	assertEdge(t, payload, "NetworkPolicy", "web", "Pod", "web-pod", "selector")
	assertEdge(t, payload, "Service", "web", "Pod", "web-pod", "selector")
	assertEdge(t, payload, "Service", "web", "EndpointSlice", "web-slice", "endpoint")
	assertEdge(t, payload, "EndpointSlice", "web-slice", "Pod", "web-pod", "endpoint")
	assertEdge(t, payload, "Pod", "web-pod", "Node", "node-1", "schedules")
	assertEdge(t, payload, "Pod", "web-pod", "ServiceAccount", "builder", "uses")
	assertEdge(t, payload, "Pod", "web-pod", "ConfigMap", "app-config", "uses")
	assertEdge(t, payload, "Pod", "web-pod", "Secret", "app-secret", "uses")
	assertEdge(t, payload, "Pod", "web-pod", "PersistentVolumeClaim", "data", "mounts")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "volume-binding")
	assertEdge(t, payload, "HorizontalPodAutoscaler", "web", "Deployment", "web", "scales")
	assertEdge(t, payload, "Ingress", "web", "Service", "web", "routes")

	if snap.Domain != objectMapDomain || snap.Stats.ItemCount != len(payload.Nodes) || snap.Stats.Truncated {
		t.Fatalf("unexpected snapshot stats: %#v", snap.Stats)
	}
}

func TestObjectMapBuildsFromPodDisruptionBudget(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapPDBFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "default:policy/v1:PodDisruptionBudget:web?maxDepth=5&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "policy" || payload.Seed.Version != "v1" || payload.Seed.Kind != "PodDisruptionBudget" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "PodDisruptionBudget", "web")
	assertNode(t, payload, "Pod", "web-pod")
	assertMissingNode(t, payload, "Pod", "api-pod")
	assertEdge(t, payload, "PodDisruptionBudget", "web", "Pod", "web-pod", "selector")
}

func TestObjectMapBuildsFromNetworkPolicyPodSelector(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapNetworkPolicyFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "default:networking.k8s.io/v1:NetworkPolicy:web?maxDepth=5&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "networking.k8s.io" || payload.Seed.Version != "v1" || payload.Seed.Kind != "NetworkPolicy" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "NetworkPolicy", "web")
	assertNode(t, payload, "Pod", "web-pod")
	assertMissingNode(t, payload, "Pod", "api-pod")
	assertEdge(t, payload, "NetworkPolicy", "web", "Pod", "web-pod", "selector")
}

func TestObjectMapNetworkPolicyEmptyPodSelectorSelectsNamespacePods(t *testing.T) {
	client := fake.NewSimpleClientset(
		podFixture("default", "web-pod", "pod-web-uid", "", map[string]string{"app": "web"}),
		podFixture("other", "other-pod", "pod-other-uid", "", map[string]string{"app": "web"}),
		networkPolicyFixture("default", "all-pods", "netpol-all-uid", metav1.LabelSelector{}),
	)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "default:networking.k8s.io/v1:NetworkPolicy:all-pods?maxDepth=5&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "NetworkPolicy", "all-pods")
	assertNode(t, payload, "Pod", "web-pod")
	assertMissingNode(t, payload, "Pod", "other-pod")
	assertEdge(t, payload, "NetworkPolicy", "all-pods", "Pod", "web-pod", "selector")
}

func TestObjectMapPodStatusRequiresAllContainersReady(t *testing.T) {
	readyContainer := func(name string) corev1.ContainerStatus {
		return corev1.ContainerStatus{
			Name:  name,
			Ready: true,
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		}
	}
	runningContainer := func(name string) corev1.ContainerStatus {
		return corev1.ContainerStatus{
			Name:  name,
			Ready: false,
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		}
	}

	tests := []struct {
		name             string
		pod              corev1.Pod
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "all regular containers ready",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Name: "app"},
					{Name: "sidecar"},
				}},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						readyContainer("app"),
						readyContainer("sidecar"),
					},
				},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "ready",
		},
		{
			name: "running phase with unready running container",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Name: "app"},
					{Name: "sidecar"},
				}},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						readyContainer("app"),
						runningContainer("sidecar"),
					},
				},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "warning",
		},
		{
			name: "running phase with missing container status",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Name: "app"},
					{Name: "sidecar"},
				}},
				Status: corev1.PodStatus{
					Phase:             corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{readyContainer("app")},
				},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "warning",
		},
		{
			name: "running phase with no container statuses",
			pod: corev1.Pod{
				Spec:   corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status: corev1.PodStatus{Phase: corev1.PodRunning},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "warning",
		},
		{
			name: "startup container creation stays degraded",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status: corev1.PodStatus{
					Phase: corev1.PodPending,
					ContainerStatuses: []corev1.ContainerStatus{{
						Name:  "app",
						State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}},
					}},
				},
			},
			wantState:        "Pending",
			wantLabel:        "ContainerCreating",
			wantPresentation: "warning",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := objectMapPodStatus("cluster-a", tt.pod)
			if status == nil || status.State != tt.wantState || status.Label != tt.wantLabel || status.Presentation != tt.wantPresentation {
				t.Fatalf("unexpected pod status: got %#v, want state=%q label=%q presentation=%q", status, tt.wantState, tt.wantLabel, tt.wantPresentation)
			}
		})
	}
}

func TestObjectMapNodeStatusUsesKubernetesReadyConditionStatus(t *testing.T) {
	readyCondition := corev1.NodeCondition{
		Type:   corev1.NodeReady,
		Status: corev1.ConditionTrue,
		Reason: "KubeletReady",
	}
	notReadyCondition := corev1.NodeCondition{
		Type:   corev1.NodeReady,
		Status: corev1.ConditionFalse,
		Reason: "KubeletNotReady",
	}

	tests := []struct {
		name             string
		node             corev1.Node
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "ready schedulable",
			node: corev1.Node{Status: corev1.NodeStatus{
				Conditions: []corev1.NodeCondition{readyCondition},
			}},
			wantState:        "True",
			wantLabel:        "Ready",
			wantPresentation: "ready",
		},
		{
			name: "ready unschedulable",
			node: corev1.Node{
				Spec: corev1.NodeSpec{Unschedulable: true},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{readyCondition},
				},
			},
			wantState:        "True",
			wantLabel:        "Ready (Cordoned)",
			wantPresentation: "cordoned",
		},
		{
			name: "ready with unschedulable taint",
			node: corev1.Node{
				Spec: corev1.NodeSpec{Taints: []corev1.Taint{{
					Key:    corev1.TaintNodeUnschedulable,
					Effect: corev1.TaintEffectNoSchedule,
				}}},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{readyCondition},
				},
			},
			wantState:        "True",
			wantLabel:        "Ready (Cordoned)",
			wantPresentation: "cordoned",
		},
		{
			name: "cordoned not ready remains false",
			node: corev1.Node{
				Spec: corev1.NodeSpec{Unschedulable: true},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{notReadyCondition},
				},
			},
			wantState:        "False",
			wantLabel:        "NotReady",
			wantPresentation: "not-ready",
		},
		{
			name: "terminating ready keeps raw ready state with terminating presentation",
			node: func() corev1.Node {
				deletingAt := metav1.NewTime(time.Date(2026, time.May, 7, 20, 15, 0, 0, time.UTC))
				return corev1.Node{
					ObjectMeta: metav1.ObjectMeta{DeletionTimestamp: &deletingAt},
					Status: corev1.NodeStatus{
						Conditions: []corev1.NodeCondition{readyCondition},
					},
				}
			}(),
			wantState:        "True",
			wantLabel:        "Terminating",
			wantPresentation: "terminating",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := objectMapNodeStatus("cluster-a", tt.node)
			if status == nil || status.State != tt.wantState || status.Label != tt.wantLabel || status.Presentation != tt.wantPresentation {
				t.Fatalf("unexpected node status: got %#v, want state=%q label=%q presentation=%q", status, tt.wantState, tt.wantLabel, tt.wantPresentation)
			}
		})
	}
}

func TestObjectMapServiceStatusUsesSharedServiceModel(t *testing.T) {
	tests := []struct {
		name             string
		service          corev1.Service
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "load balancer active",
			service: corev1.Service{
				Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeLoadBalancer},
				Status: corev1.ServiceStatus{
					LoadBalancer: corev1.LoadBalancerStatus{
						Ingress: []corev1.LoadBalancerIngress{{IP: "192.0.2.10"}},
					},
				},
			},
			wantState:        "LoadBalancer",
			wantLabel:        "LoadBalancer active",
			wantPresentation: "ready",
		},
		{
			name:             "load balancer pending",
			service:          corev1.Service{Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeLoadBalancer}},
			wantState:        "LoadBalancer",
			wantLabel:        "LoadBalancer pending",
			wantPresentation: "warning",
		},
		{
			name: "external name has no status indicator",
			service: corev1.Service{Spec: corev1.ServiceSpec{
				Type:         corev1.ServiceTypeExternalName,
				ExternalName: "example.com",
			}},
			wantState:        "ExternalName",
			wantLabel:        "ExternalName",
			wantPresentation: "ready",
		},
		{
			name:             "cluster ip reports source service type",
			service:          corev1.Service{Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP}},
			wantState:        "ClusterIP",
			wantLabel:        "ClusterIP",
			wantPresentation: "ready",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := objectMapServiceStatus("cluster-a", tt.service)
			if status == nil || status.State != tt.wantState || status.Label != tt.wantLabel || status.Presentation != tt.wantPresentation {
				t.Fatalf("unexpected service status: got %#v, want state=%q label=%q presentation=%q", status, tt.wantState, tt.wantLabel, tt.wantPresentation)
			}
		})
	}
}

func TestObjectMapEnforcesVersionedSeedScope(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	if _, err := builder.Build(ctx, "default:Deployment:web"); err == nil {
		t.Fatal("expected legacy kind-only scope to fail")
	}
}

func TestObjectMapFailsOnTransientListError(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	client.Fake.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewInternalError(fmt.Errorf("temporary pods failure"))
	})
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	if _, err := builder.Build(ctx, "default:apps/v1:Deployment:web"); err == nil {
		t.Fatal("expected transient list error to fail snapshot")
	} else if !strings.Contains(err.Error(), "pods") {
		t.Fatalf("expected error to identify failed resource, got %v", err)
	}
}

func TestObjectMapSkipsForbiddenListError(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	client.Fake.PrependReactor("list", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "", fmt.Errorf("denied"))
	})
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:apps/v1:Deployment:web?maxDepth=5&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)
	if len(payload.Warnings) == 0 || !strings.Contains(payload.Warnings[0], "secrets") {
		t.Fatalf("expected warning for skipped secrets, got %#v", payload.Warnings)
	}
	assertNode(t, payload, "Deployment", "web")
	assertMissingNode(t, payload, "Secret", "app-secret")
}

func TestObjectMapAppliesNodeCap(t *testing.T) {
	objects := []runtime.Object{
		serviceFixture("default", "web", "svc-uid", map[string]string{"app": "web"}),
	}
	for i := 0; i < 6; i++ {
		objects = append(objects, podFixture("default", "web-pod-"+string(rune('a'+i)), "pod-"+string(rune('a'+i)), "", map[string]string{"app": "web"}))
	}
	client := fake.NewSimpleClientset(objects...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:/v1:Service:web?maxDepth=1&maxNodes=3")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)
	if !payload.Truncated || !snap.Stats.Truncated {
		t.Fatalf("expected truncation, payload=%#v stats=%#v", payload, snap.Stats)
	}
	if len(payload.Nodes) != 3 {
		t.Fatalf("expected node cap to keep 3 nodes, got %d", len(payload.Nodes))
	}
}

func TestObjectMapBuildsNamespaceGraph(t *testing.T) {
	objects := append(objectMapFixtureObjects(), podFixture("other", "other-pod", "other-pod-uid", "", map[string]string{"app": "other"}))
	client := fake.NewSimpleClientset(objects...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "cluster-a|namespace:default?maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.Kind != "Namespace" || payload.Seed.Name != "default" || payload.Seed.ClusterID != "cluster-a" {
		t.Fatalf("unexpected namespace seed: %#v", payload.Seed)
	}
	assertNode(t, payload, "Deployment", "web")
	assertNode(t, payload, "ReplicaSet", "web-rs")
	assertNode(t, payload, "Pod", "web-pod")
	assertNode(t, payload, "Service", "web")
	assertNode(t, payload, "EndpointSlice", "web-slice")
	assertNode(t, payload, "PersistentVolumeClaim", "data")
	assertNode(t, payload, "PersistentVolume", "pv-data")
	assertNode(t, payload, "Node", "node-1")
	assertNode(t, payload, "Job", "unused-job")
	assertMissingNode(t, payload, "Pod", "other-pod")
	assertMissingNode(t, payload, "Namespace", "default")
	assertEdge(t, payload, "Deployment", "web", "ReplicaSet", "web-rs", "owner")
	assertEdge(t, payload, "ReplicaSet", "web-rs", "Pod", "web-pod", "owner")
	assertEdge(t, payload, "Pod", "web-pod", "Node", "node-1", "schedules")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "volume-binding")
}

func TestObjectMapNamespaceGraphDoesNotReverseExpandFromStorageClass(t *testing.T) {
	objects := append(objectMapStorageFixtureObjects(),
		&corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{Name: "pv-other", UID: types.UID("pv-other-uid")},
			Spec:       corev1.PersistentVolumeSpec{StorageClassName: "fast"},
		},
	)
	client := fake.NewSimpleClientset(objects...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "cluster-a|namespace:default?maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "StorageClass", "fast")
	assertNode(t, payload, "PersistentVolume", "pv-data")
	assertNode(t, payload, "PersistentVolume", "pv-logs")
	assertMissingNode(t, payload, "PersistentVolume", "pv-other")
}

func TestObjectMapDoesNotFanOutThroughSharedHubResources(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapHubFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:apps/v1:Deployment:web?maxDepth=6&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "Deployment", "web")
	assertNode(t, payload, "Pod", "web-pod")
	assertNode(t, payload, "Node", "node-1")
	assertNode(t, payload, "ServiceAccount", "shared")
	assertNode(t, payload, "ConfigMap", "shared-config")
	assertMissingNode(t, payload, "Deployment", "api")
	assertMissingNode(t, payload, "ReplicaSet", "api-rs")
	assertMissingNode(t, payload, "Pod", "api-pod")
}

func TestObjectMapReverseTraversesHubEdgesFromSeed(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapHubFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	nodeSnap, err := builder.Build(ctx, "__cluster__:/v1:Node:node-1?maxDepth=1&maxNodes=100")
	if err != nil {
		t.Fatalf("Build node map returned error: %v", err)
	}
	nodePayload := nodeSnap.Payload.(ObjectMapSnapshotPayload)
	assertNode(t, nodePayload, "Pod", "web-pod")
	assertNode(t, nodePayload, "Pod", "api-pod")

	configSnap, err := builder.Build(ctx, "default:/v1:ConfigMap:shared-config?maxDepth=1&maxNodes=100")
	if err != nil {
		t.Fatalf("Build config map returned error: %v", err)
	}
	configPayload := configSnap.Payload.(ObjectMapSnapshotPayload)
	assertNode(t, configPayload, "Deployment", "web")
	assertNode(t, configPayload, "Deployment", "api")
	assertNode(t, configPayload, "Pod", "web-pod")
	assertNode(t, configPayload, "Pod", "api-pod")

	serviceAccountSnap, err := builder.Build(ctx, "default:/v1:ServiceAccount:shared?maxDepth=1&maxNodes=100")
	if err != nil {
		t.Fatalf("Build service account map returned error: %v", err)
	}
	serviceAccountPayload := serviceAccountSnap.Payload.(ObjectMapSnapshotPayload)
	assertNode(t, serviceAccountPayload, "Deployment", "web")
	assertNode(t, serviceAccountPayload, "Deployment", "api")
	assertNode(t, serviceAccountPayload, "Pod", "web-pod")
	assertNode(t, serviceAccountPayload, "Pod", "api-pod")
}

func TestObjectMapNodeSeedDoesNotTraversePodForwardDependencies(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapHubFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "__cluster__:/v1:Node:node-1?maxDepth=3&maxNodes=7")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "Node", "node-1")
	assertNode(t, payload, "Pod", "web-pod")
	assertNode(t, payload, "Pod", "api-pod")
	assertNode(t, payload, "ReplicaSet", "web-rs")
	assertNode(t, payload, "ReplicaSet", "api-rs")
	assertNode(t, payload, "Deployment", "web")
	assertNode(t, payload, "Deployment", "api")
	assertEdge(t, payload, "Pod", "web-pod", "Node", "node-1", "schedules")
	assertEdge(t, payload, "Pod", "api-pod", "Node", "node-1", "schedules")
	assertEdge(t, payload, "ReplicaSet", "web-rs", "Pod", "web-pod", "owner")
	assertEdge(t, payload, "ReplicaSet", "api-rs", "Pod", "api-pod", "owner")
	assertMissingNode(t, payload, "ServiceAccount", "shared")
	assertMissingNode(t, payload, "ConfigMap", "shared-config")
	assertMissingNode(t, payload, "PersistentVolumeClaim", "data")
	if payload.Truncated {
		t.Fatalf("node map should not truncate on skipped pod dependencies: %#v", payload)
	}
}

func TestObjectMapBuildsFromStorageClass(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapStorageFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "__cluster__:storage.k8s.io/v1:StorageClass:fast?maxDepth=2&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "storage.k8s.io" || payload.Seed.Version != "v1" || payload.Seed.Kind != "StorageClass" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "StorageClass", "fast")
	assertNode(t, payload, "PersistentVolumeClaim", "data")
	assertNode(t, payload, "PersistentVolume", "pv-data")
	if status := nodeByKindName(t, payload, "StorageClass", "fast").Status; status == nil || status.State != "true" || status.Label != "Default" || status.Presentation != "ready" {
		t.Fatalf("unexpected storage class status: %#v", status)
	}
	if status := nodeByKindName(t, payload, "PersistentVolumeClaim", "data").Status; status == nil || status.State != "Bound" || status.Label != "Bound" || status.Presentation != "ready" {
		t.Fatalf("unexpected pvc status: %#v", status)
	}
	if status := nodeByKindName(t, payload, "PersistentVolume", "pv-data").Status; status == nil || status.State != "Bound" || status.Label != "Bound" || status.Presentation != "ready" {
		t.Fatalf("unexpected pv status: %#v", status)
	}
	assertNode(t, payload, "PersistentVolumeClaim", "logs")
	assertNode(t, payload, "PersistentVolume", "pv-logs")
	assertNode(t, payload, "PersistentVolumeClaim", "scratch")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "volume-binding")
	assertEdge(t, payload, "PersistentVolume", "pv-data", "StorageClass", "fast", "storage-class")
	assertEdge(t, payload, "PersistentVolumeClaim", "logs", "PersistentVolume", "pv-logs", "volume-binding")
	assertEdge(t, payload, "PersistentVolume", "pv-logs", "StorageClass", "fast", "storage-class")
	assertEdge(t, payload, "PersistentVolumeClaim", "scratch", "StorageClass", "fast", "storage-class")
	assertMissingEdge(t, payload, "PersistentVolumeClaim", "data", "StorageClass", "fast", "storage-class")
	assertMissingEdge(t, payload, "PersistentVolumeClaim", "logs", "StorageClass", "fast", "storage-class")
}

func TestObjectMapDoesNotFanOutThroughSharedStorageClass(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapStorageFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:/v1:PersistentVolumeClaim:data?maxDepth=2&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "PersistentVolumeClaim", "data")
	assertNode(t, payload, "PersistentVolume", "pv-data")
	assertNode(t, payload, "StorageClass", "fast")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "volume-binding")
	assertEdge(t, payload, "PersistentVolume", "pv-data", "StorageClass", "fast", "storage-class")
	assertMissingEdge(t, payload, "PersistentVolumeClaim", "data", "StorageClass", "fast", "storage-class")
	assertMissingNode(t, payload, "PersistentVolumeClaim", "logs")
	assertMissingNode(t, payload, "PersistentVolume", "pv-logs")
	assertMissingNode(t, payload, "PersistentVolumeClaim", "scratch")
}

func TestObjectMapReverseTraversalPolicies(t *testing.T) {
	tests := []struct {
		name         string
		edgeType     string
		currentDepth int
		want         bool
	}{
		{name: "structural relationships can recurse", edgeType: "owner", currentDepth: 5, want: true},
		{name: "RBAC grants can recurse", edgeType: "grants", currentDepth: 3, want: true},
		{name: "RBAC subject binds can recurse", edgeType: "binds", currentDepth: 3, want: true},
		{name: "storage class reverse traversal only starts at seed", edgeType: "storage-class", currentDepth: 0, want: true},
		{name: "storage class does not fan out beyond seed", edgeType: "storage-class", currentDepth: 1, want: false},
		{name: "volume binding supports StorageClass to PV to PVC", edgeType: "volume-binding", currentDepth: 1, want: true},
		{name: "volume binding stops after one hop past PV", edgeType: "volume-binding", currentDepth: 2, want: false},
		{name: "mounts only reverse from seed", edgeType: "mounts", currentDepth: 0, want: true},
		{name: "mounts do not fan out beyond seed", edgeType: "mounts", currentDepth: 1, want: false},
		{name: "unknown relationships do not reverse", edgeType: "unknown", currentDepth: 0, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canTraverseObjectMapReverse(tt.edgeType, tt.currentDepth); got != tt.want {
				t.Fatalf("canTraverseObjectMapReverse(%q, %d) = %v, want %v", tt.edgeType, tt.currentDepth, got, tt.want)
			}
		})
	}
}

func TestObjectMapBuildsFromIngressClass(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapIngressClassFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "__cluster__:networking.k8s.io/v1:IngressClass:public?maxDepth=4&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "networking.k8s.io" || payload.Seed.Version != "v1" || payload.Seed.Kind != "IngressClass" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "IngressClass", "public")
	assertNode(t, payload, "Ingress", "web")
	assertNode(t, payload, "Ingress", "api")
	assertEdge(t, payload, "Ingress", "web", "IngressClass", "public", "uses")
	assertEdge(t, payload, "Ingress", "api", "IngressClass", "public", "uses")
	assertMissingNode(t, payload, "Service", "web-svc")
}

func TestObjectMapDoesNotFanOutThroughSharedIngressClass(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapIngressClassFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:networking.k8s.io/v1:Ingress:web?maxDepth=2&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "Ingress", "web")
	assertNode(t, payload, "IngressClass", "public")
	assertEdge(t, payload, "Ingress", "web", "IngressClass", "public", "uses")
	assertMissingNode(t, payload, "Ingress", "api")
}

func TestObjectMapBuildsFromClusterRole(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapClusterRBACFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "__cluster__:rbac.authorization.k8s.io/v1:ClusterRole:admin?maxDepth=3&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "rbac.authorization.k8s.io" || payload.Seed.Version != "v1" || payload.Seed.Kind != "ClusterRole" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "ClusterRole", "admin")
	assertNode(t, payload, "ClusterRole", "view")
	assertNode(t, payload, "ClusterRoleBinding", "admin-binding")
	assertNode(t, payload, "ServiceAccount", "builder")
	assertEdge(t, payload, "ClusterRoleBinding", "admin-binding", "ClusterRole", "admin", "grants")
	assertEdge(t, payload, "ClusterRoleBinding", "admin-binding", "ServiceAccount", "builder", "binds")
	assertEdge(t, payload, "ClusterRole", "admin", "ClusterRole", "view", "aggregates")
}

func TestObjectMapBuildsFromClusterRoleBinding(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapClusterRBACFixtureObjects()...)
	builder := &objectMapBuilder{client: client}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "__cluster__:rbac.authorization.k8s.io/v1:ClusterRoleBinding:admin-binding?maxDepth=2&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "rbac.authorization.k8s.io" || payload.Seed.Version != "v1" || payload.Seed.Kind != "ClusterRoleBinding" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "ClusterRoleBinding", "admin-binding")
	assertNode(t, payload, "ClusterRole", "admin")
	assertNode(t, payload, "ServiceAccount", "builder")
	assertEdge(t, payload, "ClusterRoleBinding", "admin-binding", "ClusterRole", "admin", "grants")
	assertEdge(t, payload, "ClusterRoleBinding", "admin-binding", "ServiceAccount", "builder", "binds")
}

func objectMapFixtureObjects() []runtime.Object {
	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			UID:       types.UID("deploy-uid"),
			Labels:    map[string]string{"app": "web"},
			CreationTimestamp: metav1.NewTime(time.Date(
				2024,
				time.January,
				2,
				3,
				4,
				5,
				0,
				time.UTC,
			)),
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: int32Ptr(2),
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					ServiceAccountName: "builder",
					Volumes: []corev1.Volume{
						{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"}}}},
						{Name: "secret", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "app-secret"}}},
					},
				},
			},
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas: 2,
		},
	}
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web-rs",
			Namespace:       "default",
			UID:             types.UID("rs-uid"),
			OwnerReferences: []metav1.OwnerReference{ownerRef("apps/v1", "Deployment", "web", "deploy-uid")},
		},
	}
	pod := podFixture("default", "web-pod", "pod-uid", "rs-uid", map[string]string{"app": "web"})
	service := serviceFixture("default", "web", "svc-uid", map[string]string{"app": "web"})
	pdb := podDisruptionBudgetFixture("default", "web", "pdb-uid")
	networkPolicy := networkPolicyFixture("default", "web", "netpol-uid", labelSelectorForApp("web"))
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-slice",
			Namespace: "default",
			UID:       types.UID("slice-uid"),
			Labels:    map[string]string{discoveryv1.LabelServiceName: "web"},
		},
		Endpoints: []discoveryv1.Endpoint{{
			TargetRef: &corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "default", Name: "web-pod", UID: types.UID("pod-uid")},
		}},
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default", UID: types.UID("pvc-uid")},
		Spec: corev1.PersistentVolumeClaimSpec{
			VolumeName: "pv-data",
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("1Gi")},
			},
		},
	}
	pv := &corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pv-data", UID: types.UID("pv-uid")}}
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("hpa-uid")},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
			MinReplicas:    int32Ptr(1),
			MaxReplicas:    3,
		},
	}
	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("ingress-uid")},
		Spec: networkingv1.IngressSpec{
			DefaultBackend: &networkingv1.IngressBackend{
				Service: &networkingv1.IngressServiceBackend{Name: "web"},
			},
		},
	}

	return []runtime.Object{
		deploy,
		rs,
		pod,
		service,
		slice,
		pvc,
		pv,
		&corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default", UID: types.UID("cm-uid")},
			Data:       map[string]string{"app.yaml": "enabled: true"},
			BinaryData: map[string][]byte{"cert.der": []byte("cert")},
		},
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "app-secret", Namespace: "default", UID: types.UID("secret-uid")},
			Type:       corev1.SecretTypeOpaque,
			Data:       map[string][]byte{"password": []byte("secret")},
		},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "default", UID: types.UID("sa-uid")}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1", UID: types.UID("node-uid")}},
		hpa,
		pdb,
		networkPolicy,
		ingress,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "unused-job", Namespace: "default", UID: types.UID("job-uid")}},
	}
}

func objectMapPDBFixtureObjects() []runtime.Object {
	return []runtime.Object{
		podFixture("default", "web-pod", "pod-web-uid", "", map[string]string{"app": "web", "tier": "frontend"}),
		podFixture("default", "api-pod", "pod-api-uid", "", map[string]string{"app": "api", "tier": "frontend"}),
		podDisruptionBudgetFixture("default", "web", "pdb-web-uid"),
	}
}

func objectMapNetworkPolicyFixtureObjects() []runtime.Object {
	return []runtime.Object{
		podFixture("default", "web-pod", "pod-web-uid", "", map[string]string{"app": "web", "tier": "frontend"}),
		podFixture("default", "api-pod", "pod-api-uid", "", map[string]string{"app": "api", "tier": "frontend"}),
		networkPolicyFixture("default", "web", "netpol-web-uid", labelSelectorForApp("web")),
	}
}

func objectMapHubFixtureObjects() []runtime.Object {
	webDeploy := deploymentFixture("default", "web", "deploy-web-uid", "shared", "shared-config")
	webRS := replicaSetFixture("default", "web-rs", "rs-web-uid", "web", "deploy-web-uid")
	webPod := podFixture("default", "web-pod", "pod-web-uid", "rs-web-uid", map[string]string{"app": "web"})
	webPod.Spec.ServiceAccountName = "shared"
	useConfigMap(webPod, "shared-config")
	apiDeploy := deploymentFixture("default", "api", "deploy-api-uid", "shared", "shared-config")
	apiRS := replicaSetFixture("default", "api-rs", "rs-api-uid", "api", "deploy-api-uid")
	apiPod := podFixture("default", "api-pod", "pod-api-uid", "rs-api-uid", map[string]string{"app": "api"})
	apiPod.OwnerReferences = []metav1.OwnerReference{ownerRef("apps/v1", "ReplicaSet", "api-rs", "rs-api-uid")}
	apiPod.Spec.ServiceAccountName = "shared"
	useConfigMap(apiPod, "shared-config")

	return []runtime.Object{
		webDeploy,
		webRS,
		webPod,
		apiDeploy,
		apiRS,
		apiPod,
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1", UID: types.UID("node-uid")}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "shared", Namespace: "default", UID: types.UID("shared-sa-uid")}},
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "shared-config", Namespace: "default", UID: types.UID("shared-cm-uid")}},
		&corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default", UID: types.UID("pvc-uid")}},
	}
}

func objectMapStorageFixtureObjects() []runtime.Object {
	return []runtime.Object{
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "fast", UID: types.UID("sc-fast-uid"), Annotations: map[string]string{"storageclass.kubernetes.io/is-default-class": "true"}}},
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default", UID: types.UID("pvc-data-uid")},
			Spec: corev1.PersistentVolumeClaimSpec{
				StorageClassName: stringPtr("fast"),
				VolumeName:       "pv-data",
			},
			Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
		},
		&corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{Name: "pv-data", UID: types.UID("pv-data-uid")},
			Spec:       corev1.PersistentVolumeSpec{StorageClassName: "fast"},
			Status:     corev1.PersistentVolumeStatus{Phase: corev1.VolumeBound},
		},
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "logs", Namespace: "default", UID: types.UID("pvc-logs-uid")},
			Spec: corev1.PersistentVolumeClaimSpec{
				StorageClassName: stringPtr("fast"),
				VolumeName:       "pv-logs",
			},
			Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
		},
		&corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{Name: "pv-logs", UID: types.UID("pv-logs-uid")},
			Spec:       corev1.PersistentVolumeSpec{StorageClassName: "fast"},
			Status:     corev1.PersistentVolumeStatus{Phase: corev1.VolumeBound},
		},
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "scratch", Namespace: "default", UID: types.UID("pvc-scratch-uid")},
			Spec: corev1.PersistentVolumeClaimSpec{
				StorageClassName: stringPtr("fast"),
			},
			Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimPending},
		},
	}
}

func objectMapIngressClassFixtureObjects() []runtime.Object {
	return []runtime.Object{
		&networkingv1.IngressClass{ObjectMeta: metav1.ObjectMeta{Name: "public", UID: types.UID("ing-class-public-uid")}},
		&networkingv1.Ingress{
			ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("ing-web-uid")},
			Spec: networkingv1.IngressSpec{
				IngressClassName: stringPtr("public"),
				DefaultBackend: &networkingv1.IngressBackend{
					Service: &networkingv1.IngressServiceBackend{Name: "web-svc"},
				},
			},
		},
		serviceFixture("default", "web-svc", "svc-web-uid", nil),
		&networkingv1.Ingress{
			ObjectMeta: metav1.ObjectMeta{
				Name:        "api",
				Namespace:   "default",
				UID:         types.UID("ing-api-uid"),
				Annotations: map[string]string{"kubernetes.io/ingress.class": "public"},
			},
		},
	}
}

func objectMapClusterRBACFixtureObjects() []runtime.Object {
	return []runtime.Object{
		&rbacv1.ClusterRole{
			ObjectMeta: metav1.ObjectMeta{
				Name:   "admin",
				UID:    types.UID("cluster-role-admin-uid"),
				Labels: map[string]string{"rbac.example.com/aggregate-to-admin": "true"},
			},
			AggregationRule: &rbacv1.AggregationRule{
				ClusterRoleSelectors: []metav1.LabelSelector{{
					MatchLabels: map[string]string{"rbac.example.com/aggregate-to-admin": "true"},
				}},
			},
		},
		&rbacv1.ClusterRole{
			ObjectMeta: metav1.ObjectMeta{
				Name:   "view",
				UID:    types.UID("cluster-role-view-uid"),
				Labels: map[string]string{"rbac.example.com/aggregate-to-admin": "true"},
			},
		},
		&rbacv1.ClusterRoleBinding{
			ObjectMeta: metav1.ObjectMeta{Name: "admin-binding", UID: types.UID("cluster-role-binding-admin-uid")},
			RoleRef: rbacv1.RoleRef{
				APIGroup: "rbac.authorization.k8s.io",
				Kind:     "ClusterRole",
				Name:     "admin",
			},
			Subjects: []rbacv1.Subject{{
				Kind:      "ServiceAccount",
				Name:      "builder",
				Namespace: "default",
			}},
		},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "default", UID: types.UID("sa-builder-uid")}},
	}
}

func podDisruptionBudgetFixture(namespace, name, uid string) *policyv1.PodDisruptionBudget {
	minAvailable := intstr.FromInt32(1)
	return &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, UID: types.UID(uid)},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MinAvailable: &minAvailable,
			Selector: &metav1.LabelSelector{
				MatchExpressions: []metav1.LabelSelectorRequirement{{
					Key:      "app",
					Operator: metav1.LabelSelectorOpIn,
					Values:   []string{"web"},
				}},
			},
		},
		Status: policyv1.PodDisruptionBudgetStatus{
			DisruptionsAllowed: 1,
			CurrentHealthy:     1,
			DesiredHealthy:     1,
			ExpectedPods:       1,
		},
	}
}

func networkPolicyFixture(namespace, name, uid string, selector metav1.LabelSelector) *networkingv1.NetworkPolicy {
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, UID: types.UID(uid)},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: selector,
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				Ports: []networkingv1.NetworkPolicyPort{{}},
			}},
		},
	}
}

func labelSelectorForApp(app string) metav1.LabelSelector {
	return metav1.LabelSelector{
		MatchExpressions: []metav1.LabelSelectorRequirement{{
			Key:      "app",
			Operator: metav1.LabelSelectorOpIn,
			Values:   []string{app},
		}},
	}
}

func deploymentFixture(namespace, name, uid, serviceAccount, configMap string) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			UID:       types.UID(uid),
			Labels:    map[string]string{"app": name},
		},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					ServiceAccountName: serviceAccount,
					Volumes: []corev1.Volume{
						{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: configMap}}}},
					},
				},
			},
		},
	}
}

func replicaSetFixture(namespace, name, uid, ownerName, ownerUID string) *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       namespace,
			UID:             types.UID(uid),
			OwnerReferences: []metav1.OwnerReference{ownerRef("apps/v1", "Deployment", ownerName, ownerUID)},
		},
	}
}

func podFixture(namespace, name, uid, ownerUID string, labels map[string]string) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, UID: types.UID(uid), Labels: labels},
		Spec: corev1.PodSpec{
			NodeName:           "node-1",
			ServiceAccountName: "builder",
			Volumes: []corev1.Volume{
				{Name: "data", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data"}}},
				{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"}}}},
				{Name: "secret", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "app-secret"}}},
			},
			Containers: []corev1.Container{{
				Name:  "app",
				Image: "example/app:1",
				EnvFrom: []corev1.EnvFromSource{{
					ConfigMapRef: &corev1.ConfigMapEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"}},
				}},
			}},
		},
	}
	if ownerUID != "" {
		pod.OwnerReferences = []metav1.OwnerReference{ownerRef("apps/v1", "ReplicaSet", "web-rs", ownerUID)}
	}
	return pod
}

func useConfigMap(pod *corev1.Pod, name string) {
	if pod == nil {
		return
	}
	for volumeIndex := range pod.Spec.Volumes {
		if pod.Spec.Volumes[volumeIndex].ConfigMap != nil {
			pod.Spec.Volumes[volumeIndex].ConfigMap.Name = name
		}
	}
	for containerIndex := range pod.Spec.Containers {
		for envFromIndex := range pod.Spec.Containers[containerIndex].EnvFrom {
			if pod.Spec.Containers[containerIndex].EnvFrom[envFromIndex].ConfigMapRef != nil {
				pod.Spec.Containers[containerIndex].EnvFrom[envFromIndex].ConfigMapRef.Name = name
			}
		}
	}
}

func serviceFixture(namespace, name, uid string, selector map[string]string) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, UID: types.UID(uid)},
		Spec:       corev1.ServiceSpec{Selector: selector},
	}
}

func ownerRef(apiVersion, kind, name, uid string) metav1.OwnerReference {
	controller := true
	return metav1.OwnerReference{
		APIVersion: apiVersion,
		Kind:       kind,
		Name:       name,
		UID:        types.UID(uid),
		Controller: &controller,
	}
}

func assertEdge(t *testing.T, payload ObjectMapSnapshotPayload, sourceKind, sourceName, targetKind, targetName, edgeType string) {
	t.Helper()
	sourceID := nodeIDByKindName(t, payload, sourceKind, sourceName)
	targetID := nodeIDByKindName(t, payload, targetKind, targetName)
	for _, edge := range payload.Edges {
		if edge.Source == sourceID && edge.Target == targetID && edge.Type == edgeType {
			return
		}
	}
	t.Fatalf("missing %s edge %s/%s -> %s/%s; edges=%#v", edgeType, sourceKind, sourceName, targetKind, targetName, payload.Edges)
}

func assertMissingEdge(t *testing.T, payload ObjectMapSnapshotPayload, sourceKind, sourceName, targetKind, targetName, edgeType string) {
	t.Helper()
	sourceID := nodeIDByKindName(t, payload, sourceKind, sourceName)
	targetID := nodeIDByKindName(t, payload, targetKind, targetName)
	for _, edge := range payload.Edges {
		if edge.Source == sourceID && edge.Target == targetID && edge.Type == edgeType {
			t.Fatalf("unexpected %s edge %s/%s -> %s/%s; edges=%#v", edgeType, sourceKind, sourceName, targetKind, targetName, payload.Edges)
		}
	}
}

func nodeIDByKindName(t *testing.T, payload ObjectMapSnapshotPayload, kind, name string) string {
	t.Helper()
	return nodeByKindName(t, payload, kind, name).ID
}

func nodeByKindName(t *testing.T, payload ObjectMapSnapshotPayload, kind, name string) ObjectMapNode {
	t.Helper()
	for _, node := range payload.Nodes {
		if node.Ref.Kind == kind && node.Ref.Name == name {
			return node
		}
	}
	t.Fatalf("missing node %s/%s; nodes=%#v", kind, name, payload.Nodes)
	return ObjectMapNode{}
}

func assertNode(t *testing.T, payload ObjectMapSnapshotPayload, kind, name string) {
	t.Helper()
	_ = nodeIDByKindName(t, payload, kind, name)
}

func assertMissingNode(t *testing.T, payload ObjectMapSnapshotPayload, kind, name string) {
	t.Helper()
	for _, node := range payload.Nodes {
		if node.Ref.Kind == kind && node.Ref.Name == name {
			t.Fatalf("unexpected node %s/%s in payload: %#v", kind, name, payload.Nodes)
		}
	}
}

func int32Ptr(value int32) *int32 {
	return &value
}

func stringPtr(value string) *string {
	return &value
}
