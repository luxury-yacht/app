package snapshot

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
)

// allowAllPermissions satisfies objectMapPermissionChecker for tests, where every
// resource is listable.
type allowAllPermissions struct{}

func (allowAllPermissions) CanListWatch(string, string) bool { return true }

// newObjectMapTestBuilder builds an objectMapBuilder whose typed listers are backed
// by a started+synced informer factory over the fake clientset, mirroring how
// RegisterObjectMapDomain wires the production builder. HPA still reads live from
// the client (the autoscaling/v2 hybrid path), so the same fake clientset is kept.
func newObjectMapTestBuilder(t *testing.T, client kubernetes.Interface) *objectMapBuilder {
	t.Helper()
	shared := informers.NewSharedInformerFactory(client, 0)
	// Register every informer object-map reads before Start so the listers sync.
	shared.Core().V1().Pods().Informer()
	shared.Core().V1().Services().Informer()
	shared.Discovery().V1().EndpointSlices().Informer()
	shared.Core().V1().PersistentVolumeClaims().Informer()
	shared.Core().V1().PersistentVolumes().Informer()
	shared.Storage().V1().StorageClasses().Informer()
	shared.Core().V1().ConfigMaps().Informer()
	shared.Core().V1().Secrets().Informer()
	shared.Core().V1().ServiceAccounts().Informer()
	shared.Core().V1().Nodes().Informer()
	shared.Apps().V1().Deployments().Informer()
	shared.Apps().V1().ReplicaSets().Informer()
	shared.Apps().V1().StatefulSets().Informer()
	shared.Apps().V1().DaemonSets().Informer()
	shared.Batch().V1().Jobs().Informer()
	shared.Batch().V1().CronJobs().Informer()
	shared.Policy().V1().PodDisruptionBudgets().Informer()
	shared.Networking().V1().NetworkPolicies().Informer()
	shared.Networking().V1().Ingresses().Informer()
	shared.Networking().V1().IngressClasses().Informer()
	shared.Rbac().V1().ClusterRoles().Informer()
	shared.Rbac().V1().ClusterRoleBindings().Informer()
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	shared.Start(stop)
	// Bounded wait: if a reactor makes an informer fail to list, its reflector
	// retries forever — degrade to an empty lister instead of hanging the suite
	// until the 10-minute test timeout.
	syncCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	shared.WaitForCacheSync(syncCtx.Done())
	builder := &objectMapBuilder{
		client:      client,
		shared:      shared,
		permissions: allowAllPermissions{},
		// Ingest-owned (cut) kinds are no longer read from the shared listers; project
		// their object-map nodes through the same registry collector + edges the
		// production ingest path uses, so the test stays byte-equivalent to a real
		// reflector feeding the object map.
		ingest: newFakeObjectMapIngestSource(t, shared),
	}
	// The object catalog is seeded with a Summary for every object the map collects,
	// mirroring production: the catalog is fed from the SAME ingest/informer source the
	// object map reads, so every collected record collides (by node id) with a
	// catalog-seeded record that addCatalog adds first. Wiring it here means the whole
	// object-map suite exercises that merge path — without it no test reproduced the
	// production collision that once dropped `presented`/`ingestEdges` for cut kinds. The
	// closure reads builder.permissions at Build time so a test that denies a resource
	// (which production keeps out of the catalog too) sees it absent here as well.
	builder.catalogService = func() *objectcatalog.Service {
		return objectMapCatalogService(t, shared, builder.permissions)
	}
	return builder
}

// objectMapCatalogService builds an object-catalog Service seeded with a Summary for
// every object the object map collects from the started factory, skipping resources the
// permission checker denies. It mirrors production, where the catalog is fed from the
// same permission-gated source the object map reads, so each Summary collides by node id
// with the record the map collects for that object and the build exercises the
// catalog-merge path. ClusterID and CreationTimestamp are left empty on purpose:
// addRecord stamps the cluster id from the build meta (so the id collides whatever
// cluster the test uses), and the merge keeps the collected record's creation timestamp.
func objectMapCatalogService(t *testing.T, shared informers.SharedInformerFactory, permissions objectMapPermissionChecker) *objectcatalog.Service {
	t.Helper()
	var summaries []objectcatalog.Summary
	for _, collector := range objectMapCollectors {
		if permissions != nil && !permissions.CanListWatch(collector.Identity.Group, collector.Identity.Resource) {
			continue
		}
		scope := objectcatalog.ScopeCluster
		if collector.Identity.Namespaced {
			scope = objectcatalog.ScopeNamespace
		}
		for _, obj := range fakeIngestCollectorItems(t, collector, shared, collector.Identity.GVR()) {
			summaries = append(summaries, objectcatalog.Summary{
				Kind:      collector.Identity.Kind,
				Group:     collector.Identity.Group,
				Version:   collector.Identity.Version,
				Resource:  collector.Identity.Resource,
				Namespace: obj.GetNamespace(),
				Name:      obj.GetName(),
				UID:       string(obj.GetUID()),
				Scope:     scope,
			})
		}
	}
	return seedCatalogService(t, summaries)
}

// fakeObjectMapIngestSource projects the ingest-owned kinds' object-map nodes from
// the started shared informer cache, exactly as a production ingest reflector would
// (same collector Status/ActionFacts + same ObjectMapEdges). It lets the object-map
// tests exercise the cut path without standing up a real reflector.
type fakeObjectMapIngestSource struct {
	rows map[schema.GroupVersionResource][]interface{}
}

func newFakeObjectMapIngestSource(t *testing.T, shared informers.SharedInformerFactory) *fakeObjectMapIngestSource {
	t.Helper()
	src := &fakeObjectMapIngestSource{rows: map[schema.GroupVersionResource][]interface{}{}}
	for _, collector := range objectMapCollectors {
		gvr := collector.Identity.GVR()
		if _, cut := objectMapIngestOwnedGVRs[gvr]; !cut {
			continue
		}
		// Pod's collector.List intentionally returns nil (its production object-map nodes
		// come from the ingest reflector, not the shared informer), so list pods from the
		// shared factory directly here to stand in for what the reflector would project.
		items := fakeIngestCollectorItems(t, collector, shared, gvr)
		projector := objectmapnode.NewNodeProjector(
			collector.Status,
			collector.ActionFacts,
			objectMapEdgeBuilders[collector.Identity.Kind],
		)
		nodes := make([]interface{}, 0, len(items))
		for _, obj := range items {
			nodes = append(nodes, projector("cluster-a", obj))
		}
		src.rows[gvr] = nodes
	}
	return src
}

// fakeIngestCollectorItems lists a cut kind's objects from the shared factory for the
// fake ingest source. Pod's collector.List is a no-op (production reads pod nodes from
// the reflector), so pods are listed straight from the pod lister; every other cut kind
// uses its collector.List as before.
func fakeIngestCollectorItems(t *testing.T, collector objectmapnode.Collector, shared informers.SharedInformerFactory, gvr schema.GroupVersionResource) []metav1.Object {
	t.Helper()
	if gvr == PodGVR {
		pods, err := shared.Core().V1().Pods().Lister().List(labels.Everything())
		if err != nil {
			t.Fatalf("fake ingest source list pods: %v", err)
		}
		return objectmapnode.Objects(pods)
	}
	if gvr == NodeGVR {
		// Node's collector.List intentionally returns nil too (production reads node nodes
		// from the ingest reflector), so list nodes from the shared factory directly here.
		nodes, err := shared.Core().V1().Nodes().Lister().List(labels.Everything())
		if err != nil {
			t.Fatalf("fake ingest source list nodes: %v", err)
		}
		return objectmapnode.Objects(nodes)
	}
	items, err := collector.List(shared)
	if err != nil {
		t.Fatalf("fake ingest source list %s: %v", gvr, err)
	}
	return items
}

func (s *fakeObjectMapIngestSource) ObjectMapRows(gvr schema.GroupVersionResource) []interface{} {
	return s.rows[gvr]
}

// denyPermissions denies CanListWatch for the named resources, for tests that
// exercise the permission-gated skip in collectTyped.
type denyPermissions struct{ denied map[string]bool }

func (d denyPermissions) CanListWatch(_ string, resource string) bool { return !d.denied[resource] }

func TestObjectMapBuildsRecursiveCoreRelationships(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	builder := newObjectMapTestBuilder(t, client)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "cluster-a|default:apps/v1:Deployment:web?maxDepth=5&maxNodes=100")
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
	assertEdgesReferenceNodes(t, payload)
	if got := nodeByKindName(t, payload, "Deployment", "web").CreationTimestamp; got != "2024-01-02T03:04:05Z" {
		t.Fatalf("unexpected creation timestamp for deployment node: %q", got)
	}
	if status := nodeByKindName(t, payload, "Deployment", "web").Status; status == nil || status.State != "2/2" || status.Label != "Running" || status.Presentation != "ready" {
		t.Fatalf("unexpected deployment status: %#v", status)
	}
	if facts := nodeByKindName(t, payload, "Deployment", "web").ActionFacts; facts == nil || facts.HPAManaged == nil || !*facts.HPAManaged {
		t.Fatalf("unexpected deployment action facts: %#v", facts)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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

func TestObjectMapEnforcesVersionedSeedScope(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	builder := newObjectMapTestBuilder(t, client)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	if _, err := builder.Build(ctx, "default:Deployment:web"); err == nil {
		t.Fatal("expected legacy kind-only scope to fail")
	}
}

// Typed specs are now sourced from the shared informer caches, so object-map no
// longer hard-fails on a transient typed-list error — like every other
// lister-backed domain it serves whatever the cache holds. Resources the user
// cannot list are skipped via the CanListWatch permission gate (below) rather
// than via a per-build list error.
func TestObjectMapSkipsResourceWithoutPermission(t *testing.T) {
	client := fake.NewSimpleClientset(objectMapFixtureObjects()...)
	builder := newObjectMapTestBuilder(t, client)
	builder.permissions = denyPermissions{denied: map[string]bool{"secrets": true}}
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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
	builder := newObjectMapTestBuilder(t, client)
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

func TestObjectMapBuildsGatewayAPIRelationships(t *testing.T) {
	client := fake.NewSimpleClientset(serviceFixture("default", "web", "svc-web-uid", nil))
	gatewayClient := newObjectMapGatewayClient(t)
	if list, err := gatewayClient.GatewayV1().Gateways("default").List(context.Background(), metav1.ListOptions{}); err != nil || len(list.Items) != 1 {
		t.Fatalf("gateway fixture did not seed fake client: count=%d err=%v", len(list.Items), err)
	}
	builder := newObjectMapTestBuilder(t, client)
	builder.gatewayClient = gatewayClient
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "default:gateway.networking.k8s.io/v1:Gateway:edge?maxDepth=5&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	if payload.Seed.ClusterID != "cluster-a" || payload.Seed.Group != "gateway.networking.k8s.io" || payload.Seed.Version != "v1" || payload.Seed.Kind != "Gateway" {
		t.Fatalf("seed identity is incomplete: %#v", payload.Seed)
	}
	assertNode(t, payload, "Gateway", "edge")
	assertNode(t, payload, "GatewayClass", "public")
	assertNode(t, payload, "HTTPRoute", "web")
	assertNode(t, payload, "GRPCRoute", "grpc")
	assertNode(t, payload, "TLSRoute", "tls")
	assertNode(t, payload, "ListenerSet", "edge-extra")
	assertNode(t, payload, "Service", "web")
	assertEdge(t, payload, "Gateway", "edge", "GatewayClass", "public", "uses")
	assertEdge(t, payload, "HTTPRoute", "web", "Gateway", "edge", "uses")
	assertEdge(t, payload, "HTTPRoute", "web", "Service", "web", "routes")
	assertEdge(t, payload, "GRPCRoute", "grpc", "Gateway", "edge", "uses")
	assertEdge(t, payload, "GRPCRoute", "grpc", "Service", "web", "routes")
	assertEdge(t, payload, "TLSRoute", "tls", "Gateway", "edge", "uses")
	assertEdge(t, payload, "TLSRoute", "tls", "Service", "web", "routes")
	assertEdge(t, payload, "ListenerSet", "edge-extra", "Gateway", "edge", "uses")
	if status := nodeByKindName(t, payload, "Gateway", "edge").Status; status == nil || status.State != "0" || status.Label != "1 listener" {
		t.Fatalf("unexpected gateway status: %#v", status)
	}
}

func TestObjectMapBuildsGatewayAPIPolicyAndGrantRelationships(t *testing.T) {
	client := fake.NewSimpleClientset(serviceFixture("default", "web", "svc-web-uid", nil))
	gatewayClient := newObjectMapGatewayClient(t)
	builder := newObjectMapTestBuilder(t, client)
	builder.gatewayClient = gatewayClient
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "default:/v1:Service:web?maxDepth=3&maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "BackendTLSPolicy", "web-tls")
	assertNode(t, payload, "ReferenceGrant", "allow-web")
	assertEdge(t, payload, "BackendTLSPolicy", "web-tls", "Service", "web", "uses")
	assertEdge(t, payload, "ReferenceGrant", "allow-web", "Service", "web", "grants")
}

func TestObjectMapNamespaceGraphIncludesGatewayAPIResources(t *testing.T) {
	client := fake.NewSimpleClientset(serviceFixture("default", "web", "svc-web-uid", nil))
	gatewayClient := newObjectMapGatewayClient(t)
	builder := newObjectMapTestBuilder(t, client)
	builder.gatewayClient = gatewayClient
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "namespace:default?maxNodes=100")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertNode(t, payload, "Gateway", "edge")
	assertNode(t, payload, "GatewayClass", "public")
	assertNode(t, payload, "HTTPRoute", "web")
	assertNode(t, payload, "GRPCRoute", "grpc")
	assertNode(t, payload, "TLSRoute", "tls")
	assertNode(t, payload, "ListenerSet", "edge-extra")
	assertNode(t, payload, "ReferenceGrant", "allow-web")
	assertNode(t, payload, "BackendTLSPolicy", "web-tls")
	assertEdge(t, payload, "Gateway", "edge", "GatewayClass", "public", "uses")
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

func objectMapGatewayAPIFixtureObjects() []runtime.Object {
	backend := gatewayv1.BackendObjectReference{Name: gatewayv1.ObjectName("web")}
	return []runtime.Object{
		&gatewayv1.GatewayClass{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "GatewayClass"},
			ObjectMeta: metav1.ObjectMeta{Name: "public", UID: types.UID("gatewayclass-public-uid")},
			Spec: gatewayv1.GatewayClassSpec{
				ControllerName: gatewayv1.GatewayController("example.com/gateway-controller"),
			},
		},
		&gatewayv1.Gateway{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "Gateway"},
			ObjectMeta: metav1.ObjectMeta{Name: "edge", Namespace: "default", UID: types.UID("gateway-edge-uid")},
			Spec: gatewayv1.GatewaySpec{
				GatewayClassName: gatewayv1.ObjectName("public"),
				Listeners: []gatewayv1.Listener{{
					Name:     gatewayv1.SectionName("http"),
					Port:     gatewayv1.PortNumber(80),
					Protocol: gatewayv1.HTTPProtocolType,
				}},
			},
		},
		&gatewayv1.HTTPRoute{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "HTTPRoute"},
			ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("httproute-web-uid")},
			Spec: gatewayv1.HTTPRouteSpec{
				CommonRouteSpec: gatewayv1.CommonRouteSpec{
					ParentRefs: []gatewayv1.ParentReference{{Name: gatewayv1.ObjectName("edge")}},
				},
				Rules: []gatewayv1.HTTPRouteRule{{
					BackendRefs: []gatewayv1.HTTPBackendRef{{
						BackendRef: gatewayv1.BackendRef{BackendObjectReference: backend},
					}},
				}},
			},
		},
		&gatewayv1.GRPCRoute{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "GRPCRoute"},
			ObjectMeta: metav1.ObjectMeta{Name: "grpc", Namespace: "default", UID: types.UID("grpcroute-grpc-uid")},
			Spec: gatewayv1.GRPCRouteSpec{
				CommonRouteSpec: gatewayv1.CommonRouteSpec{
					ParentRefs: []gatewayv1.ParentReference{{Name: gatewayv1.ObjectName("edge")}},
				},
				Rules: []gatewayv1.GRPCRouteRule{{
					BackendRefs: []gatewayv1.GRPCBackendRef{{
						BackendRef: gatewayv1.BackendRef{BackendObjectReference: backend},
					}},
				}},
			},
		},
		&gatewayv1.TLSRoute{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "TLSRoute"},
			ObjectMeta: metav1.ObjectMeta{Name: "tls", Namespace: "default", UID: types.UID("tlsroute-tls-uid")},
			Spec: gatewayv1.TLSRouteSpec{
				CommonRouteSpec: gatewayv1.CommonRouteSpec{
					ParentRefs: []gatewayv1.ParentReference{{Name: gatewayv1.ObjectName("edge")}},
				},
				Rules: []gatewayv1.TLSRouteRule{{
					BackendRefs: []gatewayv1.BackendRef{{BackendObjectReference: backend}},
				}},
			},
		},
		&gatewayv1.ListenerSet{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "ListenerSet"},
			ObjectMeta: metav1.ObjectMeta{Name: "edge-extra", Namespace: "default", UID: types.UID("listenerset-edge-extra-uid")},
			Spec: gatewayv1.ListenerSetSpec{
				ParentRef: gatewayv1.ParentGatewayReference{Name: gatewayv1.ObjectName("edge")},
			},
		},
		&gatewayv1.ReferenceGrant{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "ReferenceGrant"},
			ObjectMeta: metav1.ObjectMeta{Name: "allow-web", Namespace: "default", UID: types.UID("referencegrant-allow-web-uid")},
			Spec: gatewayv1.ReferenceGrantSpec{
				From: []gatewayv1.ReferenceGrantFrom{{
					Group:     gatewayv1.Group("gateway.networking.k8s.io"),
					Kind:      gatewayv1.Kind("HTTPRoute"),
					Namespace: gatewayv1.Namespace("default"),
				}},
				To: []gatewayv1.ReferenceGrantTo{{
					Group: gatewayv1.Group(""),
					Kind:  gatewayv1.Kind("Service"),
					Name:  objectNamePtr("web"),
				}},
			},
		},
		&gatewayv1.BackendTLSPolicy{
			TypeMeta:   metav1.TypeMeta{APIVersion: "gateway.networking.k8s.io/v1", Kind: "BackendTLSPolicy"},
			ObjectMeta: metav1.ObjectMeta{Name: "web-tls", Namespace: "default", UID: types.UID("backendtlspolicy-web-tls-uid")},
			Spec: gatewayv1.BackendTLSPolicySpec{
				TargetRefs: []gatewayv1.LocalPolicyTargetReferenceWithSectionName{{
					LocalPolicyTargetReference: gatewayv1.LocalPolicyTargetReference{
						Group: gatewayv1.Group(""),
						Kind:  gatewayv1.Kind("Service"),
						Name:  gatewayv1.ObjectName("web"),
					},
				}},
			},
		},
	}
}

func newObjectMapGatewayClient(t *testing.T) *gatewayfake.Clientset {
	t.Helper()
	client := gatewayfake.NewClientset()
	var gatewayClasses []gatewayv1.GatewayClass
	var gateways []gatewayv1.Gateway
	var httpRoutes []gatewayv1.HTTPRoute
	var grpcRoutes []gatewayv1.GRPCRoute
	var tlsRoutes []gatewayv1.TLSRoute
	var listenerSets []gatewayv1.ListenerSet
	var referenceGrants []gatewayv1.ReferenceGrant
	var backendTLSPolicies []gatewayv1.BackendTLSPolicy
	for _, obj := range objectMapGatewayAPIFixtureObjects() {
		switch item := obj.(type) {
		case *gatewayv1.GatewayClass:
			gatewayClasses = append(gatewayClasses, *item)
		case *gatewayv1.Gateway:
			gateways = append(gateways, *item)
		case *gatewayv1.HTTPRoute:
			httpRoutes = append(httpRoutes, *item)
		case *gatewayv1.GRPCRoute:
			grpcRoutes = append(grpcRoutes, *item)
		case *gatewayv1.TLSRoute:
			tlsRoutes = append(tlsRoutes, *item)
		case *gatewayv1.ListenerSet:
			listenerSets = append(listenerSets, *item)
		case *gatewayv1.ReferenceGrant:
			referenceGrants = append(referenceGrants, *item)
		case *gatewayv1.BackendTLSPolicy:
			backendTLSPolicies = append(backendTLSPolicies, *item)
		default:
			t.Fatalf("unsupported gateway api fixture type %T", obj)
		}
	}
	client.Fake.PrependReactor("list", "gatewayclasses", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.GatewayClassList{Items: gatewayClasses}, nil
	})
	client.Fake.PrependReactor("list", "gateways", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.GatewayList{Items: gateways}, nil
	})
	client.Fake.PrependReactor("list", "httproutes", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.HTTPRouteList{Items: httpRoutes}, nil
	})
	client.Fake.PrependReactor("list", "grpcroutes", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.GRPCRouteList{Items: grpcRoutes}, nil
	})
	client.Fake.PrependReactor("list", "tlsroutes", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.TLSRouteList{Items: tlsRoutes}, nil
	})
	client.Fake.PrependReactor("list", "listenersets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.ListenerSetList{Items: listenerSets}, nil
	})
	client.Fake.PrependReactor("list", "referencegrants", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.ReferenceGrantList{Items: referenceGrants}, nil
	})
	client.Fake.PrependReactor("list", "backendtlspolicies", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.BackendTLSPolicyList{Items: backendTLSPolicies}, nil
	})
	return client
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

func assertEdgesReferenceNodes(t *testing.T, payload ObjectMapSnapshotPayload) {
	t.Helper()
	nodeIDs := make(map[string]struct{}, len(payload.Nodes))
	for _, node := range payload.Nodes {
		nodeIDs[node.ID] = struct{}{}
	}
	for _, edge := range payload.Edges {
		if _, ok := nodeIDs[edge.Source]; !ok {
			t.Fatalf("edge source %q does not reference a node: %#v", edge.Source, edge)
		}
		if _, ok := nodeIDs[edge.Target]; !ok {
			t.Fatalf("edge target %q does not reference a node: %#v", edge.Target, edge)
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

func objectNamePtr(value string) *gatewayv1.ObjectName {
	name := gatewayv1.ObjectName(value)
	return &name
}
