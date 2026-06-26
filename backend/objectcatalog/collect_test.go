/*
 * backend/objectcatalog/collect_test.go
 *
 * Catalog collection and summary generation tests.
 */

package objectcatalog

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestServiceSyncCollectsResources(t *testing.T) {
	scheme := runtime.NewScheme()
	appsGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(appsGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(appsGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(appsGVK)
	obj.SetNamespace("default")
	obj.SetName("demo")
	obj.SetCreationTimestamp(metav1.NewTime(time.Date(2023, 3, 4, 12, 0, 0, 0, time.UTC)))
	obj.SetLabels(map[string]string{"app": "demo", "tier": "backend"})

	obj.SetResourceVersion("1")

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds)
	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	if _, err := dyn.Resource(gvr).Namespace("default").Create(context.Background(), obj.DeepCopy(), metav1.CreateOptions{}); err != nil {
		t.Fatalf("failed to seed dynamic client: %v", err)
	}

	checkList, err := dyn.Resource(gvr).Namespace(metav1.NamespaceAll).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		t.Fatalf("failed to list seeded resources: %v", err)
	}
	if len(checkList.Items) != 1 {
		t.Fatalf("expected seeded resource visible, got %d", len(checkList.Items))
	}

	now := func() time.Time { return time.Date(2023, 3, 4, 12, 5, 0, 0, time.UTC) }

	deps := Dependencies{
		Common: common.Dependencies{
			Context:       context.Background(),
			DynamicClient: dyn,
		},
		Now: now,
	}

	svc := NewService(deps, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2})
	desc := resourceDescriptor{
		GVR:        gvr,
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
	summaries, err := svc.collectResource(context.Background(), 0, desc, nil, nil)
	if err != nil {
		t.Fatalf("collectResource failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("unexpected catalog size: got %d, want 1", len(summaries))
	}

	summary := summaries[0]
	if summary.Kind != "Deployment" {
		t.Errorf("unexpected kind: %s", summary.Kind)
	}
	if summary.Namespace != "default" {
		t.Errorf("unexpected namespace: %s", summary.Namespace)
	}
	if summary.Name != "demo" {
		t.Errorf("unexpected name: %s", summary.Name)
	}
	if summary.Scope != ScopeNamespace {
		t.Errorf("unexpected scope: %s", summary.Scope)
	}
	if summary.LabelsDigest == "" {
		t.Errorf("expected labels digest to be set")
	}
}

// fakeCatalogIngestSource is a test IngestSource that serves pre-seeded Summaries for
// a cut GVR, so the catalog ingest collect path can be exercised without a real
// reflector.
type fakeCatalogIngestSource struct {
	rows   map[schema.GroupVersionResource][]interface{}
	synced map[schema.GroupVersionResource]bool
}

func (f *fakeCatalogIngestSource) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	return f.rows[gvr]
}

func (f *fakeCatalogIngestSource) AddCatalogSink(schema.GroupVersionResource, ingest.Sink) bool {
	return true
}

// The dynamic-CRD path is not exercised by the static-cut-kind tests below, so these
// satisfy the IngestSource interface as no-ops.
func (f *fakeCatalogIngestSource) RegisterDynamicCatalogReflector(schema.GroupVersionResource, schema.GroupVersionKind, ingest.CatalogProjector) bool {
	return false
}

func (f *fakeCatalogIngestSource) StopReflectorFor(schema.GroupVersionResource) {}

func (f *fakeCatalogIngestSource) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	if f.synced == nil {
		return true
	}
	return f.synced[gvr]
}

func TestIngestCatalogSinkBulkReplaceScopesGVR(t *testing.T) {
	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	svc := NewService(Dependencies{Now: func() time.Time { return now }}, nil)
	cmGVR := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	secGVR := schema.GroupVersionResource{Version: "v1", Resource: "secrets"}
	cmDesc := resourceDescriptor{GVR: cmGVR, Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespaced: true, Scope: ScopeNamespace}
	secDesc := resourceDescriptor{GVR: secGVR, Version: "v1", Kind: "Secret", Resource: "secrets", Namespaced: true, Scope: ScopeNamespace}
	svc.resources = map[string]resourceDescriptor{
		cmGVR.String():  cmDesc,
		secGVR.String(): secDesc,
	}
	sec := Summary{Kind: "Secret", Version: "v1", Resource: "secrets", Namespace: "default", Name: "sec-a", Scope: ScopeNamespace}
	oldCM := Summary{Kind: "ConfigMap", Version: "v1", Resource: "configmaps", Namespace: "default", Name: "cm-old", Scope: ScopeNamespace}
	svc.items = map[string]Summary{
		catalogKey(secDesc, sec.Namespace, sec.Name):    sec,
		catalogKey(cmDesc, oldCM.Namespace, oldCM.Name): oldCM,
	}
	svc.catalogIndex.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	sink := ingestCatalogSink{service: svc, gvr: cmGVR}
	bulk, ok := interface{}(sink).(ingest.ReplaceSink)
	if !ok {
		t.Fatal("ingest catalog sink must support bulk replace")
	}
	newCM := Summary{Kind: "ConfigMap", Version: "v1", Resource: "configmaps", Namespace: "default", Name: "cm-new", Scope: ScopeNamespace}
	bulk.Replace([]interface{}{newCM})

	if _, ok := svc.items[catalogKey(cmDesc, "default", "cm-old")]; ok {
		t.Fatal("old ConfigMap summary survived bulk replace")
	}
	if _, ok := svc.items[catalogKey(cmDesc, "default", "cm-new")]; !ok {
		t.Fatal("new ConfigMap summary missing after bulk replace")
	}
	if _, ok := svc.items[catalogKey(secDesc, "default", "sec-a")]; !ok {
		t.Fatal("Secret summary was removed by ConfigMap bulk replace")
	}

	bulk.Replace(nil)
	if _, ok := svc.items[catalogKey(cmDesc, "default", "cm-new")]; ok {
		t.Fatal("ConfigMap summary survived empty bulk replace")
	}
	if _, ok := svc.items[catalogKey(secDesc, "default", "sec-a")]; !ok {
		t.Fatal("Secret summary was removed by empty ConfigMap bulk replace")
	}
}

// TestCollectViaIngestServesCutKindSummaries proves a cut kind's collect is served
// from the ingest manager's CatalogRows (projected at intake), scoped to the
// requested namespaces, and byte-identical to the catalog's own summaryFromObject —
// the catalog-quotas-Summaries gate for the owned-reflector cutover.
func TestCollectViaIngestServesCutKindSummaries(t *testing.T) {
	// A real ingest-owned GVR from the registry's facet, so the cut-set membership
	// check passes exactly as in production.
	var cutGVR schema.GroupVersionResource
	for gvr := range catalogIngestOwnedGVRs {
		if gvr.Resource == "resourcequotas" {
			cutGVR = gvr
		}
	}
	if cutGVR.Empty() {
		t.Fatal("expected resourcequotas in the ingest-owned cut set")
	}

	desc := builtinDescriptor(cutGVR.Group, cutGVR.Version, "ResourceQuota", cutGVR.Resource, true)
	obj := &metav1.PartialObjectMetadata{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "compute", ResourceVersion: "7"},
	}
	want := summaryFromObject("c1", "cluster-one", desc, obj)
	other := summaryFromObject("c1", "cluster-one", desc,
		&metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Namespace: "team-b", Name: "other", ResourceVersion: "8"}})

	source := &fakeCatalogIngestSource{
		rows: map[schema.GroupVersionResource][]interface{}{cutGVR: {want, other}},
	}
	svc := NewService(Dependencies{IngestSource: source, ClusterID: "c1", ClusterName: "cluster-one"}, nil)

	// Namespace-scoped request to team-a returns only the team-a summary, byte-identical.
	summaries, handled, err := svc.collectViaIngest(0, desc, []string{"team-a"}, nil)
	if err != nil || !handled {
		t.Fatalf("collectViaIngest handled=%v err=%v, want handled=true err=nil", handled, err)
	}
	if len(summaries) != 1 {
		t.Fatalf("got %d summaries, want 1 (scoped to team-a)", len(summaries))
	}
	if summaries[0] != want {
		t.Fatalf("summary = %#v, want byte-identical %#v", summaries[0], want)
	}

	// An all-namespaces request returns both, proving no scoping when none requested.
	all, handled, err := svc.collectViaIngest(0, desc, nil, nil)
	if err != nil || !handled || len(all) != 2 {
		t.Fatalf("all-namespaces collectViaIngest handled=%v err=%v len=%d, want true/nil/2", handled, err, len(all))
	}
}

// TestCollectViaIngestAlwaysHandlesCutKind proves a cut kind's collect is ALWAYS
// served by ingest — even with no rows yet — so the catalog never falls through to
// the shared factory for a GVR the factory no longer registers (which would lazily
// create an unstarted informer). An uncut GVR is not handled, so the factory/list
// path still serves it.
func TestCollectViaIngestAlwaysHandlesCutKind(t *testing.T) {
	var cutGVR schema.GroupVersionResource
	for gvr := range catalogIngestOwnedGVRs {
		if gvr.Resource == "resourcequotas" {
			cutGVR = gvr
		}
	}
	cutDesc := builtinDescriptor(cutGVR.Group, cutGVR.Version, "ResourceQuota", cutGVR.Resource, true)
	source := &fakeCatalogIngestSource{
		rows: map[schema.GroupVersionResource][]interface{}{cutGVR: {}},
	}
	svc := NewService(Dependencies{IngestSource: source}, nil)
	if summaries, handled, err := svc.collectViaIngest(0, cutDesc, nil, nil); !handled || err != nil || len(summaries) != 0 {
		t.Fatalf("cut kind collectViaIngest handled=%v err=%v len=%d, want true/nil/0", handled, err, len(summaries))
	}

	// HorizontalPodAutoscaler is NOT cut (it keeps its typed informer — no v2 shared informer
	// for the ingest path), so its collect must NOT be handled by ingest — the factory/list
	// path still serves it.
	uncutDesc := builtinDescriptor("autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", false)
	if _, handled, _ := svc.collectViaIngest(0, uncutDesc, nil, nil); handled {
		t.Fatal("uncut kind must not be handled by ingest")
	}
}

func TestCollectViaIngestReportsUnsyncedStaticCutKind(t *testing.T) {
	var cutGVR schema.GroupVersionResource
	for gvr := range catalogIngestOwnedGVRs {
		if gvr.Resource == "resourcequotas" {
			cutGVR = gvr
		}
	}
	cutDesc := builtinDescriptor(cutGVR.Group, cutGVR.Version, "ResourceQuota", cutGVR.Resource, true)
	source := &fakeCatalogIngestSource{
		rows:   map[schema.GroupVersionResource][]interface{}{cutGVR: {}},
		synced: map[schema.GroupVersionResource]bool{cutGVR: false},
	}
	svc := NewService(Dependencies{IngestSource: source}, nil)

	summaries, handled, err := svc.collectViaIngest(0, cutDesc, nil, nil)
	if !handled {
		t.Fatal("unsynced static cut kind must still be handled by ingest")
	}
	if err == nil {
		t.Fatal("unsynced static cut kind must report an incomplete collect")
	}
	if len(summaries) != 0 {
		t.Fatalf("unsynced static cut kind returned %d summaries, want 0", len(summaries))
	}
}

func TestLabelsDigestDeterministic(t *testing.T) {
	a := labelsDigest(map[string]string{
		"b": "2",
		"a": "1",
	})
	b := labelsDigest(map[string]string{
		"a": "1",
		"b": "2",
	})
	if a == "" || b == "" {
		t.Fatalf("expected non-empty digest")
	}
	if a != b {
		t.Fatalf("expected digests to match, got %s and %s", a, b)
	}
}

func TestLabelsDigestEmpty(t *testing.T) {
	if digest := labelsDigest(nil); digest != "" {
		t.Fatalf("expected empty digest, got %q", digest)
	}
}

func TestCollectResourceWithoutDynamicClient(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	desc := resourceDescriptor{}
	if _, err := svc.collectResource(context.Background(), 0, desc, nil, nil); err == nil {
		t.Fatalf("expected error when dynamic client missing")
	}
}

func TestCollectResourceHandlesPagination(t *testing.T) {
	scheme := runtime.NewScheme()
	appsGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(appsGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(appsGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	})

	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	page := 0
	dyn.PrependReactor("list", "deployments", func(action k8stesting.Action) (handled bool, ret runtime.Object, err error) {
		page++
		token := ""
		items := []unstructured.Unstructured{}
		if page == 1 {
			obj := &unstructured.Unstructured{}
			obj.SetGroupVersionKind(appsGVK)
			obj.SetNamespace("default")
			obj.SetName("demo")
			obj.SetResourceVersion("1")
			items = append(items, *obj)
			token = "next"
		}
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(appsGVK.GroupVersion().WithKind("DeploymentList"))
		list.Items = append(list.Items, items...)
		list.SetContinue(token)
		return true, list, nil
	})

	svc := NewService(Dependencies{Common: common.Dependencies{DynamicClient: dyn}}, &Options{PageSize: 1})
	desc := resourceDescriptor{GVR: gvr, Namespaced: true, Scope: ScopeNamespace}
	summaries, err := svc.collectResource(context.Background(), 0, desc, nil, nil)
	if err != nil {
		t.Fatalf("collectResource failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected single item after pagination, got %d", len(summaries))
	}
	if summaries[0].Name != "demo" {
		t.Fatalf("expected summary to contain paginated object, got %s", summaries[0].Name)
	}
}

func TestListResourceParallelNamespaces(t *testing.T) {
	scheme := runtime.NewScheme()
	cfgGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(cfgGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(cfgGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}

	objA := &unstructured.Unstructured{}
	objA.SetGroupVersionKind(cfgGVK)
	objA.SetNamespace("alpha")
	objA.SetName("sample-a")

	objB := &unstructured.Unstructured{}
	objB.SetGroupVersionKind(cfgGVK)
	objB.SetNamespace("beta")
	objB.SetName("sample-b")

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, objA, objB)

	client := kubernetesfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Namespaced: true, Kind: "Deployment", Verbs: []string{"list"}},
			},
		},
	}

	svc := NewService(Dependencies{Common: common.Dependencies{KubernetesClient: client, DynamicClient: dyn}}, &Options{NamespaceWorkers: 4, PageSize: 10})

	desc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	items, err := svc.listResource(context.Background(), 0, desc, []string{"alpha", "beta"}, nil)
	if err != nil {
		t.Fatalf("listResource returned error: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected results from both namespaces, got %d", len(items))
	}
	names := map[string]struct{}{}
	for _, item := range items {
		names[item.Name] = struct{}{}
	}
	if _, ok := names["sample-a"]; !ok {
		t.Fatalf("expected sample-a in results")
	}
	if _, ok := names["sample-b"]; !ok {
		t.Fatalf("expected sample-b in results")
	}
}

func TestBuildSummaryNamespaced(t *testing.T) {
	desc := resourceDescriptor{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Scope: ScopeNamespace}
	obj := &unstructured.Unstructured{}
	obj.SetNamespace("default")
	obj.SetName("example")
	obj.SetLabels(map[string]string{"app": "demo"})

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	summary := svc.buildSummary(desc, obj)
	if summary.Namespace != "default" {
		t.Fatalf("expected namespace to be preserved")
	}
	if summary.LabelsDigest == "" {
		t.Fatalf("expected labels digest to be populated")
	}
}

func TestBuildSummaryIncludesActionFactsFromUnstructured(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)

	deploy := &unstructured.Unstructured{
		Object: map[string]any{
			"spec": map[string]any{
				"replicas": int64(3),
				"template": map[string]any{
					"spec": map[string]any{
						"containers": []any{
							map[string]any{
								"ports": []any{map[string]any{"containerPort": int64(8080), "protocol": "TCP"}},
							},
						},
					},
				},
			},
		},
	}
	deploy.SetName("web")
	deploy.SetNamespace("default")
	deploySummary := svc.buildSummary(
		resourceDescriptor{Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments", Scope: ScopeNamespace},
		deploy,
	)
	if deploySummary.ActionFacts == nil || deploySummary.ActionFacts.DesiredReplicas == nil || *deploySummary.ActionFacts.DesiredReplicas != 3 {
		t.Fatalf("expected deployment desired replica action fact, got %#v", deploySummary.ActionFacts)
	}
	if deploySummary.ActionFacts.PortForwardAvailable == nil || !*deploySummary.ActionFacts.PortForwardAvailable {
		t.Fatalf("expected deployment port-forward action fact, got %#v", deploySummary.ActionFacts)
	}

	cron := &unstructured.Unstructured{Object: map[string]any{"spec": map[string]any{"suspend": true}}}
	cron.SetName("nightly")
	cron.SetNamespace("default")
	cronSummary := svc.buildSummary(
		resourceDescriptor{Kind: "CronJob", Group: "batch", Version: "v1", Resource: "cronjobs", Scope: ScopeNamespace},
		cron,
	)
	if cronSummary.ActionFacts == nil || cronSummary.ActionFacts.Status != "Suspended" {
		t.Fatalf("expected suspended cronjob action fact, got %#v", cronSummary.ActionFacts)
	}
}

func TestEnrichCatalogActionFactsMarksHPAManagedWorkloads(t *testing.T) {
	falseValue := false
	items := map[string]Summary{
		"hpa": {
			Kind:      "HorizontalPodAutoscaler",
			Group:     "autoscaling",
			Version:   "v2",
			Resource:  "horizontalpodautoscalers",
			Namespace: "default",
			Name:      "web",
			ActionFacts: &ActionFacts{ScaleTarget: &ActionScaleTarget{
				Group:     "apps",
				Version:   "v1",
				Kind:      "Deployment",
				Namespace: "default",
				Name:      "web",
			}},
		},
		"managed": {
			Kind:        "Deployment",
			Group:       "apps",
			Version:     "v1",
			Resource:    "deployments",
			Namespace:   "default",
			Name:        "web",
			ActionFacts: &ActionFacts{HPAManaged: &falseValue},
		},
		"unmanaged": {
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "api",
		},
	}
	allowed := map[string]resourceDescriptor{
		"autoscaling/v2/horizontalpodautoscalers": {
			Group:    "autoscaling",
			Version:  "v2",
			Resource: "horizontalpodautoscalers",
		},
	}

	enrichCatalogActionFacts(items, allowed, nil)

	if items["managed"].ActionFacts == nil || items["managed"].ActionFacts.HPAManaged == nil || !*items["managed"].ActionFacts.HPAManaged {
		t.Fatalf("expected managed deployment to be marked HPA-managed, got %#v", items["managed"].ActionFacts)
	}
	if items["unmanaged"].ActionFacts == nil || items["unmanaged"].ActionFacts.HPAManaged == nil || *items["unmanaged"].ActionFacts.HPAManaged {
		t.Fatalf("expected unmanaged deployment to be marked not HPA-managed, got %#v", items["unmanaged"].ActionFacts)
	}
}

func TestBuildSummaryClusterScope(t *testing.T) {
	desc := resourceDescriptor{
		Kind:     "CustomThing",
		Group:    "custom.io",
		Version:  "v1",
		Resource: "customthings",
		Scope:    ScopeCluster,
	}

	obj := &unstructured.Unstructured{}
	obj.SetName("example")
	obj.SetCreationTimestamp(metav1.NewTime(time.Date(2023, 1, 2, 3, 4, 5, 0, time.UTC)))

	svc := NewService(Dependencies{Now: time.Now, Common: common.Dependencies{}}, nil)
	summary := svc.buildSummary(desc, obj)

	if summary.Namespace != "" {
		t.Fatalf("expected cluster-scoped resource to have empty namespace, got %q", summary.Namespace)
	}
	if summary.Scope != ScopeCluster {
		t.Fatalf("expected cluster scope, got %s", summary.Scope)
	}
	if summary.CreationTimestamp != "2023-01-02T03:04:05Z" {
		t.Fatalf("unexpected creation timestamp %s", summary.CreationTimestamp)
	}
}
