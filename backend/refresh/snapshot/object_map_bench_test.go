package snapshot

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	configmappkg "github.com/luxury-yacht/app/backend/resources/configmap"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	endpointslicepkg "github.com/luxury-yacht/app/backend/resources/endpointslice"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	networkpolicypkg "github.com/luxury-yacht/app/backend/resources/networkpolicy"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	pdbpkg "github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	podpkg "github.com/luxury-yacht/app/backend/resources/pods"
	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
	serviceaccountpkg "github.com/luxury-yacht/app/backend/resources/serviceaccount"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
)

const (
	objectMapBenchClusterID         = "bench"
	objectMapBenchPodsPerNamespace  = 100
	objectMapBenchWorkloadsPerNS    = 10
	objectMapBenchPodsPerNode       = 50
	objectMapBenchCustomRowsPerNS   = 10
	objectMapBenchNamespaceMaxNodes = 1000
)

// BenchmarkObjectMapBuild times one object-map build per iteration against a
// synthetic cluster fed from the same sources production reads: ingest
// projections for ingest-owned kinds, informer caches for ReplicaSets and HPAs,
// and one prebuilt object catalog. Fixture construction stays outside the
// timed loop. Set OBJECT_MAP_BENCH_LARGE=1 to add the 50k-Pod cluster.
func BenchmarkObjectMapBuild(b *testing.B) {
	sizes := []int{1_000, 10_000}
	if os.Getenv("OBJECT_MAP_BENCH_LARGE") != "" {
		sizes = append(sizes, 50_000)
	}
	scopes := []struct{ name, scope string }{
		{"object", "ns-0:apps/v1:Deployment:app-0"},
		{"namespace", fmt.Sprintf("namespace:ns-0?maxNodes=%d", objectMapBenchNamespaceMaxNodes)},
	}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: objectMapBenchClusterID})
	for _, pods := range sizes {
		fixture := newObjectMapBenchFixture(b, pods)
		for _, scope := range scopes {
			b.Run(fmt.Sprintf("pods=%d/%s", pods, scope.name), func(b *testing.B) {
				fixture.timeBuilds(b, ctx, scope.scope)
			})
		}
	}
}

// timeBuilds checks the fixture once untimed, then times only Build.
func (f *objectMapBenchFixture) timeBuilds(b *testing.B, ctx context.Context, scope string) {
	f.assertBuild(b, ctx, scope)
	b.ReportAllocs()
	for b.Loop() {
		if _, err := f.builder.Build(ctx, scope); err != nil {
			b.Fatal(err)
		}
	}
}

type objectMapBenchFixture struct {
	builder      *objectMapBuilder
	ingest       *fakeObjectMapIngestSource
	catalog      *objectcatalog.Service
	pods         int
	catalogRows  int
	collectorFor map[schema.GroupVersionResource]objectmapnode.Collector
	shared       informers.SharedInformerFactory
	summaries    []objectcatalog.Summary
}

func newObjectMapBenchFixture(b testing.TB, pods int) *objectMapBenchFixture {
	b.Helper()
	fixture := &objectMapBenchFixture{
		ingest:       &fakeObjectMapIngestSource{rows: map[schema.GroupVersionResource][]interface{}{}},
		pods:         pods,
		collectorFor: map[schema.GroupVersionResource]objectmapnode.Collector{},
		// Never started: listers read the indexers populated below.
		shared: informers.NewSharedInformerFactory(fake.NewSimpleClientset(), 0),
	}
	for _, collector := range objectMapCollectors {
		fixture.collectorFor[collector.Identity.GVR()] = collector
	}
	for node := 0; node < pods/objectMapBenchPodsPerNode; node++ {
		fixture.add(b, nodepkg.Identity, &corev1.Node{ObjectMeta: benchMeta("Node", "", fmt.Sprintf("node-%d", node))})
	}
	for ns := 0; ns < pods/objectMapBenchPodsPerNamespace; ns++ {
		fixture.addNamespace(b, fmt.Sprintf("ns-%d", ns))
	}
	fixture.catalog = seedCatalogService(b, fixture.summaries)
	fixture.catalogRows = len(fixture.summaries)
	catalog := fixture.catalog
	fixture.builder = &objectMapBuilder{
		shared:         fixture.shared,
		permissions:    allowAllPermissions{},
		ingest:         fixture.ingest,
		catalogService: func() *objectcatalog.Service { return catalog },
	}
	return fixture
}

func (f *objectMapBenchFixture) addNamespace(b testing.TB, ns string) {
	podsPerWorkload := objectMapBenchPodsPerNamespace / objectMapBenchWorkloadsPerNS
	f.add(b, serviceaccountpkg.Identity, &corev1.ServiceAccount{ObjectMeta: benchMeta("ServiceAccount", ns, "default")})
	for workload := 0; workload < objectMapBenchWorkloadsPerNS; workload++ {
		app := fmt.Sprintf("app-%d", workload)
		template := corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": app}}}
		deploy := &appsv1.Deployment{ObjectMeta: benchMeta("Deployment", ns, app), Spec: appsv1.DeploymentSpec{Template: template}}
		f.add(b, deploymentpkg.Identity, deploy)
		rs := &appsv1.ReplicaSet{ObjectMeta: benchMeta("ReplicaSet", ns, app+"-rs"), Spec: appsv1.ReplicaSetSpec{Template: template}}
		rs.OwnerReferences = []metav1.OwnerReference{ownerRef("apps/v1", "Deployment", app, string(deploy.UID))}
		f.add(b, replicasetpkg.Identity, rs)
		f.add(b, configmappkg.Identity, &corev1.ConfigMap{ObjectMeta: benchMeta("ConfigMap", ns, app+"-config")})
		f.add(b, secretpkg.Identity, &corev1.Secret{ObjectMeta: benchMeta("Secret", ns, app+"-secret")})
		slice := &discoveryv1.EndpointSlice{ObjectMeta: benchMeta("EndpointSlice", ns, app+"-slice")}
		svc := &corev1.Service{ObjectMeta: benchMeta("Service", ns, app), Spec: corev1.ServiceSpec{Selector: map[string]string{"app": app}}}
		slice.Labels = map[string]string{discoveryv1.LabelServiceName: app}
		slice.OwnerReferences = []metav1.OwnerReference{ownerRef("v1", "Service", app, string(svc.UID))}
		for replica := 0; replica < podsPerWorkload; replica++ {
			pod := benchPod(ns, fmt.Sprintf("%s-%d", app, replica), app, string(rs.UID), f.nodeFor(ns, workload, replica))
			f.add(b, podpkg.Identity, pod)
			slice.Endpoints = append(slice.Endpoints, discoveryv1.Endpoint{
				Addresses: []string{"10.0.0.1"},
				TargetRef: &corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: ns, Name: pod.Name, UID: pod.UID},
			})
		}
		f.add(b, servicepkg.Identity, svc)
		f.add(b, endpointslicepkg.Identity, slice)
	}
	f.addNamespacePolicies(b, ns)
	for row := 0; row < objectMapBenchCustomRowsPerNS; row++ {
		widget := benchMeta("Widget", ns, fmt.Sprintf("widget-%d", row))
		f.addCatalogRow(resourcekind.Identity{Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Namespaced: true}, &widget)
	}
}

func (f *objectMapBenchFixture) addNamespacePolicies(b testing.TB, ns string) {
	for i := 0; i < 2; i++ {
		selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": fmt.Sprintf("app-%d", i)}}
		f.add(b, pdbpkg.Identity, &policyv1.PodDisruptionBudget{ObjectMeta: benchMeta("PodDisruptionBudget", ns, fmt.Sprintf("pdb-%d", i)), Spec: policyv1.PodDisruptionBudgetSpec{Selector: selector}})
		f.add(b, networkpolicypkg.Identity, &networkingv1.NetworkPolicy{ObjectMeta: benchMeta("NetworkPolicy", ns, fmt.Sprintf("netpol-%d", i)), Spec: networkingv1.NetworkPolicySpec{PodSelector: *selector}})
	}
	hpa := &autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: benchMeta("HorizontalPodAutoscaler", ns, "app-0")}
	hpa.Spec.ScaleTargetRef = autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "app-0"}
	f.add(b, hpapkg.Identity, hpa)
}

func (f *objectMapBenchFixture) nodeFor(ns string, workload, replica int) string {
	nodes := f.pods / objectMapBenchPodsPerNode
	return fmt.Sprintf("node-%d", (len(ns)*7+workload*13+replica)%nodes)
}

// add routes an object to the source production reads it from and records its
// catalog row: ingest projections for ingest-owned kinds, informer indexers for
// the shared-informer kinds the map lists.
func (f *objectMapBenchFixture) add(b testing.TB, identity resourcekind.Identity, obj metav1.Object) {
	gvr := identity.GVR()
	f.addCatalogRow(identity, obj)
	if _, owned := objectMapIngestOwnedGVRs[gvr]; owned {
		collector, ok := f.collectorFor[gvr]
		if !ok {
			b.Fatalf("no object-map collector for ingest-owned %s", gvr)
		}
		project := objectmapnode.NewNodeProjector(collector.Status, collector.ActionFacts, objectMapEdgeBuilders[identity.Kind])
		f.ingest.rows[gvr] = append(f.ingest.rows[gvr], project(objectMapBenchClusterID, obj))
		return
	}
	var err error
	switch typed := obj.(type) {
	case *appsv1.ReplicaSet:
		err = f.shared.Apps().V1().ReplicaSets().Informer().GetIndexer().Add(typed)
	case *autoscalingv2.HorizontalPodAutoscaler:
		err = f.shared.Autoscaling().V2().HorizontalPodAutoscalers().Informer().GetIndexer().Add(typed)
	default:
		b.Fatalf("no informer source for %s", gvr)
	}
	if err != nil {
		b.Fatal(err)
	}
}

func (f *objectMapBenchFixture) addCatalogRow(identity resourcekind.Identity, obj metav1.Object) {
	scope := objectcatalog.ScopeCluster
	if identity.Namespaced {
		scope = objectcatalog.ScopeNamespace
	}
	f.summaries = append(f.summaries, objectcatalog.Summary{
		Ref: resourcemodel.ResourceRef{
			ClusterID: objectMapBenchClusterID,
			Group:     identity.Group, Version: identity.Version, Kind: identity.Kind, Resource: identity.Resource,
			Namespace: obj.GetNamespace(), Name: obj.GetName(), UID: string(obj.GetUID()),
		},
		Scope: scope,
	})
}

// assertBuild proves the fixture feeds the builder before any timing: every
// source holds its rows, and one build returns the seed's ReplicaSet.
func (f *objectMapBenchFixture) assertBuild(b *testing.B, ctx context.Context, scope string) {
	b.Helper()
	if got := len(f.ingest.rows[PodGVR]); got != f.pods {
		b.Fatalf("ingest pod rows = %d, want %d", got, f.pods)
	}
	if got := f.catalog.Count(); got != f.catalogRows {
		b.Fatalf("catalog rows = %d, want %d", got, f.catalogRows)
	}
	snap, err := f.builder.Build(ctx, scope)
	if err != nil {
		b.Fatal(err)
	}
	payload := snap.Payload.(ObjectMapSnapshotPayload)
	for _, node := range payload.Nodes {
		if node.Ref.Kind == "ReplicaSet" && node.Ref.Namespace == "ns-0" && node.Ref.Name == "app-0-rs" {
			return
		}
	}
	b.Fatalf("build of %q has no ReplicaSet ns-0/app-0-rs among %d nodes", scope, len(payload.Nodes))
}

// benchMeta gives each object a UID unique across kinds, since object-map node
// ids are UID-based.
func benchMeta(kind, namespace, name string) metav1.ObjectMeta {
	return metav1.ObjectMeta{
		Namespace: namespace,
		Name:      name,
		UID:       types.UID(fmt.Sprintf("%s/%s/%s", kind, namespace, name)),
	}
}

func benchPod(namespace, name, app, ownerUID, nodeName string) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: benchMeta("Pod", namespace, name),
		Spec: corev1.PodSpec{
			NodeName:           nodeName,
			ServiceAccountName: "default",
			Volumes: []corev1.Volume{
				{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: app + "-config"}}}},
				{Name: "secret", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: app + "-secret"}}},
			},
		},
	}
	pod.Labels = map[string]string{"app": app}
	pod.OwnerReferences = []metav1.OwnerReference{ownerRef("apps/v1", "ReplicaSet", app+"-rs", ownerUID)}
	return pod
}
