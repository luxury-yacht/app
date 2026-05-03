package snapshot

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
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

	assertEdge(t, payload, "Deployment", "web", "ReplicaSet", "web-rs", "owner")
	assertEdge(t, payload, "ReplicaSet", "web-rs", "Pod", "web-pod", "owner")
	assertEdge(t, payload, "Service", "web", "Pod", "web-pod", "selector")
	assertEdge(t, payload, "Service", "web", "EndpointSlice", "web-slice", "endpoint")
	assertEdge(t, payload, "EndpointSlice", "web-slice", "Pod", "web-pod", "endpoint")
	assertEdge(t, payload, "Pod", "web-pod", "Node", "node-1", "schedules")
	assertEdge(t, payload, "Pod", "web-pod", "ServiceAccount", "builder", "uses")
	assertEdge(t, payload, "Pod", "web-pod", "ConfigMap", "app-config", "uses")
	assertEdge(t, payload, "Pod", "web-pod", "Secret", "app-secret", "uses")
	assertEdge(t, payload, "Pod", "web-pod", "PersistentVolumeClaim", "data", "mounts")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "storage")
	assertEdge(t, payload, "HorizontalPodAutoscaler", "web", "Deployment", "web", "scales")
	assertEdge(t, payload, "Ingress", "web", "Service", "web", "routes")

	if snap.Domain != objectMapDomain || snap.Stats.ItemCount != len(payload.Nodes) || snap.Stats.Truncated {
		t.Fatalf("unexpected snapshot stats: %#v", snap.Stats)
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

	snap, err := builder.Build(ctx, "__cluster__:storage.k8s.io/v1:StorageClass:fast?maxDepth=1&maxNodes=100")
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
	assertNode(t, payload, "PersistentVolumeClaim", "logs")
	assertNode(t, payload, "PersistentVolume", "pv-logs")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "StorageClass", "fast", "storage")
	assertEdge(t, payload, "PersistentVolume", "pv-data", "StorageClass", "fast", "storage")
	assertEdge(t, payload, "PersistentVolumeClaim", "logs", "StorageClass", "fast", "storage")
	assertEdge(t, payload, "PersistentVolume", "pv-logs", "StorageClass", "fast", "storage")
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
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "storage")
	assertEdge(t, payload, "PersistentVolumeClaim", "data", "StorageClass", "fast", "storage")
	assertEdge(t, payload, "PersistentVolume", "pv-data", "StorageClass", "fast", "storage")
	assertMissingNode(t, payload, "PersistentVolumeClaim", "logs")
	assertMissingNode(t, payload, "PersistentVolume", "pv-logs")
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

func objectMapFixtureObjects() []runtime.Object {
	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			UID:       types.UID("deploy-uid"),
			Labels:    map[string]string{"app": "web"},
		},
		Spec: appsv1.DeploymentSpec{
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
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default", UID: types.UID("cm-uid")}},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "app-secret", Namespace: "default", UID: types.UID("secret-uid")}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "default", UID: types.UID("sa-uid")}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1", UID: types.UID("node-uid")}},
		hpa,
		ingress,
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "unused-job", Namespace: "default", UID: types.UID("job-uid")}},
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
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "fast", UID: types.UID("sc-fast-uid")}},
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default", UID: types.UID("pvc-data-uid")},
			Spec: corev1.PersistentVolumeClaimSpec{
				StorageClassName: stringPtr("fast"),
				VolumeName:       "pv-data",
			},
		},
		&corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{Name: "pv-data", UID: types.UID("pv-data-uid")},
			Spec:       corev1.PersistentVolumeSpec{StorageClassName: "fast"},
		},
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "logs", Namespace: "default", UID: types.UID("pvc-logs-uid")},
			Spec: corev1.PersistentVolumeClaimSpec{
				StorageClassName: stringPtr("fast"),
				VolumeName:       "pv-logs",
			},
		},
		&corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{Name: "pv-logs", UID: types.UID("pv-logs-uid")},
			Spec:       corev1.PersistentVolumeSpec{StorageClassName: "fast"},
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

func nodeIDByKindName(t *testing.T, payload ObjectMapSnapshotPayload, kind, name string) string {
	t.Helper()
	for _, node := range payload.Nodes {
		if node.Ref.Kind == kind && node.Ref.Name == name {
			return node.ID
		}
	}
	t.Fatalf("missing node %s/%s; nodes=%#v", kind, name, payload.Nodes)
	return ""
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
