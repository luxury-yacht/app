/*
 * backend/objectcatalog/collect_test.go
 *
 * Catalog collection and summary generation tests.
 */

package objectcatalog

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	"k8s.io/client-go/informers"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
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
			DynamicClient: dyn,
		},
		Now: now,
	}

	svc := NewService(deps, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2})
	desc := Descriptor{

		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
	summaries, err := svc.collectResource(context.Background(), desc, nil, nil)
	if err != nil {
		t.Fatalf("collectResource failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("unexpected catalog size: got %d, want 1", len(summaries))
	}

	summary := summaries[0]
	if summary.Ref.Kind != "Deployment" {
		t.Errorf("unexpected kind: %s", summary.Ref.Kind)
	}
	if summary.Ref.Namespace != "default" {
		t.Errorf("unexpected namespace: %s", summary.Ref.Namespace)
	}
	if summary.Ref.Name != "demo" {
		t.Errorf("unexpected name: %s", summary.Ref.Name)
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
func (f *fakeCatalogIngestSource) RegisterDynamicCatalogReflector(schema.GroupVersionResource, schema.GroupVersionKind, ingest.CatalogProjector, bool) bool {
	return false
}

func (f *fakeCatalogIngestSource) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	if f.synced == nil {
		return true
	}
	return f.synced[gvr]
}

func (f *fakeCatalogIngestSource) Tracks(gvr schema.GroupVersionResource) bool {
	if _, ok := f.rows[gvr]; ok {
		return true
	}
	_, ok := f.synced[gvr]
	return ok
}

func TestIngestCatalogSinkBulkReplaceScopesGVR(t *testing.T) {
	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	svc := NewService(Dependencies{Now: func() time.Time { return now }}, nil)
	cmGVR := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	secGVR := schema.GroupVersionResource{Version: "v1", Resource: "secrets"}
	cmDesc := Descriptor{Group: cmGVR.Group, Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespaced: true, Scope: ScopeNamespace}
	secDesc := Descriptor{Group: secGVR.Group, Version: "v1", Kind: "Secret", Resource: "secrets", Namespaced: true, Scope: ScopeNamespace}
	svc.resources = map[string]Descriptor{
		cmGVR.String():  cmDesc,
		secGVR.String(): secDesc,
	}
	sec := Summary{Ref: resourcemodel.ResourceRef{Version: "v1", Kind: "Secret", Resource: "secrets", Namespace: "default", Name: "sec-a"}, Scope: ScopeNamespace}
	oldCM := Summary{Ref: resourcemodel.ResourceRef{Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespace: "default", Name: "cm-old"}, Scope: ScopeNamespace}
	svc.items = map[string]Summary{
		catalogKey(secDesc, sec.Ref.Namespace, sec.Ref.Name):    sec,
		catalogKey(cmDesc, oldCM.Ref.Namespace, oldCM.Ref.Name): oldCM,
	}
	svc.catalogIndex.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	sink := ingestCatalogSink{service: svc, gvr: cmGVR}
	bulk, ok := interface{}(sink).(ingest.Replacer)
	if !ok {
		t.Fatal("ingest catalog sink must support bulk replace")
	}
	newCM := Summary{Ref: resourcemodel.ResourceRef{Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespace: "default", Name: "cm-new"}, Scope: ScopeNamespace}
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
	want := summaryFromObject("c1", desc, obj)
	other := summaryFromObject("c1", desc,
		&metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Namespace: "team-b", Name: "other", ResourceVersion: "8"}})

	source := &fakeCatalogIngestSource{
		rows: map[schema.GroupVersionResource][]interface{}{cutGVR: {want, other}},
	}
	svc := NewService(Dependencies{IngestSource: source, ClusterID: "c1"}, nil)

	// Namespace-scoped request to team-a returns only the team-a summary, byte-identical.
	summaries, handled, err := svc.collectViaIngest(desc, []string{"team-a"}, nil)
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
	all, handled, err := svc.collectViaIngest(desc, nil, nil)
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
	if summaries, handled, err := svc.collectViaIngest(cutDesc, nil, nil); !handled || err != nil || len(summaries) != 0 {
		t.Fatalf("cut kind collectViaIngest handled=%v err=%v len=%d, want true/nil/0", handled, err, len(summaries))
	}

	// HorizontalPodAutoscaler is NOT cut (it keeps its typed informer — no v2 shared informer
	// for the ingest path), so its collect must NOT be handled by ingest — the factory/list
	// path still serves it.
	uncutDesc := builtinDescriptor("autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", false)
	if _, handled, _ := svc.collectViaIngest(uncutDesc, nil, nil); handled {
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

	summaries, handled, err := svc.collectViaIngest(cutDesc, nil, nil)
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
	desc := Descriptor{}
	if _, err := svc.collectResource(context.Background(), desc, nil, nil); err == nil {
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
	desc := Descriptor{Group: gvr.Group, Version: gvr.Version, Resource: gvr.Resource, Namespaced: true, Scope: ScopeNamespace}
	summaries, err := svc.collectResource(context.Background(), desc, nil, nil)
	if err != nil {
		t.Fatalf("collectResource failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected single item after pagination, got %d", len(summaries))
	}
	if summaries[0].Ref.Name != "demo" {
		t.Fatalf("expected summary to contain paginated object, got %s", summaries[0].Ref.Name)
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

	desc := Descriptor{

		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	items, err := svc.listResource(context.Background(), desc, []string{"alpha", "beta"}, nil)
	if err != nil {
		t.Fatalf("listResource returned error: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected results from both namespaces, got %d", len(items))
	}
	names := map[string]struct{}{}
	for _, item := range items {
		names[item.Ref.Name] = struct{}{}
	}
	if _, ok := names["sample-a"]; !ok {
		t.Fatalf("expected sample-a in results")
	}
	if _, ok := names["sample-b"]; !ok {
		t.Fatalf("expected sample-b in results")
	}
}

func TestBuildSummaryNamespaced(t *testing.T) {
	desc := Descriptor{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Scope: ScopeNamespace}
	obj := &unstructured.Unstructured{}
	obj.SetNamespace("default")
	obj.SetName("example")
	obj.SetLabels(map[string]string{"app": "demo"})
	obj.SetAnnotations(map[string]string{"example.com/note": "managed"})

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	summary := svc.buildSummary(desc, obj)
	if summary.Ref.Namespace != "default" {
		t.Fatalf("expected namespace to be preserved")
	}
	if summary.LabelsDigest == "" {
		t.Fatalf("expected labels digest to be populated")
	}
	if summary.Metadata == nil || summary.Metadata.Labels["app"] != "demo" || summary.Metadata.Annotations["example.com/note"] != "managed" {
		t.Fatalf("expected exact labels and annotations to be projected, got %#v", summary.Metadata)
	}
}

func TestBuildSummaryCapturesFinalizerBlockedForBackendConsumers(t *testing.T) {
	desc := Descriptor{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Scope: ScopeNamespace}
	deletionTimestamp := metav1.NewTime(time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC))
	obj := &unstructured.Unstructured{}
	obj.SetNamespace("default")
	obj.SetName("example")
	obj.SetDeletionTimestamp(&deletionTimestamp)
	obj.SetFinalizers([]string{"example.com/cleanup"})

	summary := summaryFromObject("cluster-a", desc, obj)
	if _, blocked := summary.FinalizerBlocker(); !blocked {
		t.Fatal("expected deleting object with a finalizer to be marked finalizer-blocked")
	}

	obj.SetFinalizers(nil)
	if _, blocked := summaryFromObject("cluster-a", desc, obj).FinalizerBlocker(); blocked {
		t.Fatal("expected deleting object without a finalizer not to be marked finalizer-blocked")
	}
}

func TestBuildSummaryTreatsNamespaceSpecFinalizersAsDeletionBlockers(t *testing.T) {
	deletingAt := metav1.NewTime(time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC))
	namespace := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "attention-finalizer-demo",
			UID:               "namespace-uid",
			DeletionTimestamp: &deletingAt,
		},
		Spec: corev1.NamespaceSpec{Finalizers: []corev1.FinalizerName{"kubernetes"}},
	}
	desc := builtinDescriptor("", "v1", "Namespace", "namespaces", false)

	summary := summaryFromObject("cluster-a", desc, namespace)
	blocker, blocked := summary.FinalizerBlocker()
	require.True(t, blocked)
	require.Equal(t, "cluster-a", blocker.Ref.ClusterID)
	require.Equal(t, "Namespace", blocker.Ref.Kind)
	require.Equal(t, deletingAt.UnixMilli(), blocker.DeletionTimestamp)

	unstructuredNamespace := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Namespace",
		"metadata": map[string]interface{}{
			"name":              "dynamic-path",
			"uid":               "dynamic-uid",
			"deletionTimestamp": deletingAt.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{"finalizers": []interface{}{"kubernetes"}},
	}}
	dynamicSummary := summaryFromObject("cluster-a", desc, unstructuredNamespace)
	_, dynamicBlocked := dynamicSummary.FinalizerBlocker()
	require.True(t, dynamicBlocked, "the dynamic list fallback must preserve Namespace spec.finalizers")
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
		Descriptor{Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments", Scope: ScopeNamespace},
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
		Descriptor{Kind: "CronJob", Group: "batch", Version: "v1", Resource: "cronjobs", Scope: ScopeNamespace},
		cron,
	)
	if cronSummary.ActionFacts == nil || cronSummary.ActionFacts.Status != "Suspended" {
		t.Fatalf("expected suspended cronjob action fact, got %#v", cronSummary.ActionFacts)
	}
}

func TestEnrichCatalogActionFactsMarksHPAManagedWorkloads(t *testing.T) {
	falseValue := false
	items := map[string]Summary{
		"hpa": {Ref: resourcemodel.ResourceRef{Group: "autoscaling", Version: "v2", Kind: "HorizontalPodAutoscaler", Resource: "horizontalpodautoscalers", Namespace: "default", Name: "web"}, ActionFacts: &ActionFacts{ScaleTarget: &ActionScaleTarget{
			Group:     "apps",
			Version:   "v1",
			Kind:      "Deployment",
			Namespace: "default",
			Name:      "web",
		}},
		},
		"managed":   {Ref: resourcemodel.ResourceRef{Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "default", Name: "web"}, ActionFacts: &ActionFacts{HPAManaged: &falseValue}},
		"unmanaged": {Ref: resourcemodel.ResourceRef{Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "default", Name: "api"}},
	}
	allowed := map[string]Descriptor{
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
	desc := Descriptor{
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

	if summary.Ref.Namespace != "" {
		t.Fatalf("expected cluster-scoped resource to have empty namespace, got %q", summary.Ref.Namespace)
	}
	if summary.Scope != ScopeCluster {
		t.Fatalf("expected cluster scope, got %s", summary.Scope)
	}
	if summary.CreationTimestamp != "2023-01-02T03:04:05Z" {
		t.Fatalf("unexpected creation timestamp %s", summary.CreationTimestamp)
	}
}

// Scoped clusters (docs/architecture/namespace-scope.md): one forbidden namespace
// must not blank the other configured namespaces' results — the Lens dual-path
// pitfall (b) this plan explicitly avoids.
func TestListResourceSkipsForbiddenNamespaceTargets(t *testing.T) {
	scheme := runtime.NewScheme()
	cfgGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}

	objA := &unstructured.Unstructured{}
	objA.SetGroupVersionKind(cfgGVK)
	objA.SetNamespace("alpha")
	objA.SetName("sample-a")

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, objA)
	dyn.PrependReactor("list", "deployments", func(action k8stesting.Action) (bool, runtime.Object, error) {
		if action.GetNamespace() == "beta" {
			return true, nil, k8serrors.NewForbidden(schema.GroupResource{Group: "apps", Resource: "deployments"}, "", errors.New("denied"))
		}
		return false, nil, nil
	})

	svc := NewService(Dependencies{Common: common.Dependencies{KubernetesClient: kubernetesfake.NewClientset(), DynamicClient: dyn}}, &Options{PageSize: 10})

	desc := Descriptor{

		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	items, err := svc.listResource(context.Background(), desc, []string{"alpha", "beta"}, nil)
	if err != nil {
		t.Fatalf("a forbidden namespace must be skipped, not fail the kind: %v", err)
	}
	if len(items) != 1 || items[0].Ref.Name != "sample-a" {
		t.Fatalf("expected only alpha's item, got %#v", items)
	}
}

func TestServiceScopeNamespacesComeFromDependencies(t *testing.T) {
	svc := NewService(Dependencies{AllowedNamespaces: []string{"prod", "dev"}, Common: common.Dependencies{}}, nil)
	got := svc.scopeNamespaces()
	if len(got) != 2 || got[0] != "prod" || got[1] != "dev" {
		t.Fatalf("scopeNamespaces = %#v, want configured scope", got)
	}

	unscoped := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	if ns := unscoped.scopeNamespaces(); ns != nil {
		t.Fatalf("unscoped service must report nil scope, got %#v", ns)
	}
}

// Catalog action availability must agree for Service ports and container ports,
// including malformed entries returned through dynamic discovery.
func TestCatalogPortForwardFactsPreserveProtocolEligibility(t *testing.T) {
	for _, kind := range []string{"Pod", "Service", "Deployment", "DaemonSet", "CronJob"} {
		for _, test := range []struct {
			name  string
			ports []any
			want  bool
		}{
			{name: "no ports"},
			{name: "UDP only", ports: []any{map[string]any{"protocol": "UDP"}}},
			{name: "malformed entry", ports: []any{"invalid"}},
			{name: "TCP after invalid and UDP", ports: []any{"invalid", map[string]any{"protocol": "UDP"}, map[string]any{"protocol": "TCP"}}, want: true},
			{name: "default protocol", ports: []any{map[string]any{}}, want: true},
			{name: "case insensitive TCP", ports: []any{map[string]any{"protocol": "tcp"}}, want: true},
		} {
			t.Run(kind+"/"+test.name, func(t *testing.T) {
				desc := Descriptor{Version: "v1", Kind: kind, Scope: ScopeNamespace, Namespaced: true}
				portOwner := map[string]any{"ports": test.ports}
				spec := map[string]any{"containers": []any{"invalid", portOwner}}
				switch kind {
				case "Service":
					spec = portOwner
				case "Deployment", "DaemonSet":
					desc.Group = "apps"
					spec = map[string]any{"template": map[string]any{"spec": spec}}
				case "CronJob":
					desc.Group = "batch"
					spec = map[string]any{"jobTemplate": map[string]any{"spec": map[string]any{"template": map[string]any{"spec": spec}}}}
				}
				object := &unstructured.Unstructured{Object: map[string]any{"spec": spec}}
				object.SetName("forwardable")
				object.SetNamespace("team")
				summary := summaryFromObject("cluster-a", desc, object)
				require.NotNil(t, summary.ActionFacts)
				require.NotNil(t, summary.ActionFacts.PortForwardAvailable)
				require.Equal(t, test.want, *summary.ActionFacts.PortForwardAvailable)
			})
		}
	}
}

func (*fakeCatalogIngestSource) ReadDynamicCatalogSource(schema.GroupResource) (ingest.DynamicCatalogSnapshot, bool) {
	return ingest.DynamicCatalogSnapshot{}, false
}
func (*fakeCatalogIngestSource) SubscribeDynamicCatalogChanges(func(ingest.DynamicCatalogChange)) func() {
	return func() {}
}

func (*fakeCatalogIngestSource) IsDynamicCatalogGeneration(schema.GroupResource, uint64) bool {
	return false
}

func (*fakeCatalogIngestSource) ReconcileDiscoveredResource(schema.GroupVersionResource) bool {
	return false
}

func (source *fakeCatalogIngestSource) SubscribeCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) func() {
	source.AddCatalogSink(gvr, sink)
	return func() {}
}

func (*fakeCatalogIngestSource) PartitionReadinessFor(schema.GroupVersionResource) []ingest.PartitionReadiness {
	return nil
}

// An informer can stop blocking startup before its initial LIST finishes: it
// passed the factory's sync deadline and is still retrying. Its empty cache does
// not prove the objects are gone, so the kind must fail and keep its published
// rows, like an unsynced ingest store, until a retry can read the synced cache.
func TestCatalogFailsKindWhileInformerIsStillSyncing(t *testing.T) {
	tests := []struct {
		name     string
		desc     Descriptor
		register func(*Dependencies)
	}{{
		name:     "shared informer",
		desc:     Descriptor{Group: "apps", Version: "v1", Resource: "replicasets", Kind: "ReplicaSet", Scope: ScopeNamespace, Namespaced: true},
		register: registerUnsyncedReplicaSetInformer,
	}, {
		name: "CRD informer",
		desc: Descriptor{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions", Kind: "CustomResourceDefinition", Scope: ScopeCluster},
		register: func(deps *Dependencies) {
			factory := apiextinformers.NewSharedInformerFactory(apiextensionsfake.NewClientset(), 0)
			factory.Apiextensions().V1().CustomResourceDefinitions().Informer()
			deps.APIExtensionsInformerFactory = factory
		},
	}}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// The API holds no objects, so listing it instead would also delete the row.
			deps := Dependencies{
				ClusterID: "c1",
				Common: common.Dependencies{DynamicClient: dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(),
					map[schema.GroupVersionResource]string{test.desc.GVR(): test.desc.Kind + "List"})},
				InformerReadiness: informerReadinessStub{readiness: refresh.ResourceReadinessDegraded},
			}
			test.register(&deps)
			svc := newSingleKindCatalog(deps, test.desc)
			object := &unstructured.Unstructured{}
			object.SetGroupVersionKind(schema.GroupVersionKind{Group: test.desc.Group, Version: test.desc.Version, Kind: test.desc.Kind})
			if test.desc.Namespaced {
				object.SetNamespace("default")
			}
			object.SetName("retained")
			old := summaryFromObject("c1", test.desc, object)
			svc.items[catalogKey(test.desc, object.GetNamespace(), object.GetName())] = old
			svc.catalogIndex.rebuildCacheFromItems(svc.items, []Descriptor{test.desc})

			err := svc.sync(t.Context())

			var partial *PartialSyncError
			require.ErrorAs(t, err, &partial)
			require.Equal(t, []string{test.desc.GVR().String()}, partial.FailedDescriptors)
			require.Equal(t, []Summary{old}, svc.Query(QueryOptions{Kinds: []string{test.desc.Kind}}).Items,
				"a still-syncing informer's empty cache must not delete the kind's published rows")
		})
	}
}

// An informer the factory reports unavailable will never sync: the API refused
// its watch after the permission check passed, or it was created after the
// factory started (for example Gateway API installed while connected). The kind
// is collected from the API, as when the permission check denies the informer.
func TestCatalogListsLiveWhenInformerIsUnavailable(t *testing.T) {
	desc := Descriptor{Group: "apps", Version: "v1", Resource: "replicasets", Kind: "ReplicaSet", Scope: ScopeNamespace, Namespaced: true}
	live := &unstructured.Unstructured{}
	live.SetGroupVersionKind(schema.GroupVersionKind{Group: desc.Group, Version: desc.Version, Kind: desc.Kind})
	live.SetNamespace("default")
	live.SetName("live")
	live.SetUID("live-uid")
	deps := Dependencies{
		ClusterID: "c1",
		Common: common.Dependencies{DynamicClient: dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(),
			map[schema.GroupVersionResource]string{desc.GVR(): "ReplicaSetList"}, live)},
		InformerReadiness: informerReadinessStub{readiness: refresh.ResourceReadinessUnavailable},
	}
	registerUnsyncedReplicaSetInformer(&deps)
	svc := newSingleKindCatalog(deps, desc)

	require.NoError(t, svc.sync(t.Context()))

	rows := svc.Query(QueryOptions{Kinds: []string{desc.Kind}}).Items
	require.Len(t, rows, 1, "an unavailable informer's empty cache must not be published as the kind's membership")
	require.Equal(t, "live", rows[0].Ref.Name)
	require.Equal(t, "c1", rows[0].Ref.ClusterID)
}

// A synced informer is the kind's authoritative source: collection publishes its
// cache without an API LIST. Each informer factory the catalog reads is covered.
func TestCatalogReadsSyncedInformerWithoutListingAPI(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	cached := metav1.ObjectMeta{Name: "cached", UID: "cached-uid"}
	namespacedCached := metav1.ObjectMeta{Name: "cached", Namespace: "default", UID: "cached-uid"}
	tests := []struct {
		name     string
		desc     Descriptor
		register func(ctx context.Context, deps *Dependencies)
	}{{
		name: "shared informer",
		desc: Descriptor{Group: "apps", Version: "v1", Resource: "replicasets", Kind: "ReplicaSet", Scope: ScopeNamespace, Namespaced: true},
		register: func(ctx context.Context, deps *Dependencies) {
			factory := informers.NewSharedInformerFactory(kubernetesfake.NewClientset(&appsv1.ReplicaSet{ObjectMeta: namespacedCached}), 0)
			factory.Apps().V1().ReplicaSets().Informer()
			factory.Start(ctx.Done())
			factory.WaitForCacheSync(ctx.Done())
			deps.InformerFactory = factory
		},
	}, {
		name: "CRD informer",
		desc: Descriptor{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions", Kind: "CustomResourceDefinition", Scope: ScopeCluster},
		register: func(ctx context.Context, deps *Dependencies) {
			factory := apiextinformers.NewSharedInformerFactory(apiextensionsfake.NewClientset(&apiextensionsv1.CustomResourceDefinition{ObjectMeta: cached}), 0)
			factory.Apiextensions().V1().CustomResourceDefinitions().Informer()
			factory.Start(ctx.Done())
			factory.WaitForCacheSync(ctx.Done())
			deps.APIExtensionsInformerFactory = factory
		},
	}, {
		name: "Gateway API informer",
		desc: Descriptor{Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gatewayclasses", Kind: "GatewayClass", Scope: ScopeCluster},
		register: func(ctx context.Context, deps *Dependencies) {
			factory := gatewayinformers.NewSharedInformerFactory(gatewayfake.NewSimpleClientset(&gatewayv1.GatewayClass{ObjectMeta: cached}), 0)
			factory.Gateway().V1().GatewayClasses().Informer()
			factory.Start(ctx.Done())
			factory.WaitForCacheSync(ctx.Done())
			deps.GatewayInformerFactory = factory
		},
	}}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
			listed := false
			dynamicClient.PrependReactor("list", "*", func(k8stesting.Action) (bool, runtime.Object, error) {
				listed = true
				return true, nil, errors.New("collection must read the synced informer")
			})
			deps := Dependencies{
				ClusterID:         "c1",
				Common:            common.Dependencies{DynamicClient: dynamicClient},
				InformerReadiness: informerReadinessStub{readiness: refresh.ResourceReadinessReady},
			}
			test.register(t.Context(), &deps)
			svc := newSingleKindCatalog(deps, test.desc)

			require.NoError(t, svc.sync(t.Context()))

			rows := svc.Query(QueryOptions{Kinds: []string{test.desc.Kind}}).Items
			require.Len(t, rows, 1)
			require.Equal(t, "cached", rows[0].Ref.Name)
			require.False(t, listed, "a synced informer must serve the kind without an API LIST")
		})
	}
}

// registerUnsyncedReplicaSetInformer registers a ReplicaSet informer that is never
// started, so its cache stays empty and unsynced.
func registerUnsyncedReplicaSetInformer(deps *Dependencies) {
	factory := informers.NewSharedInformerFactory(kubernetesfake.NewClientset(), 0)
	factory.Apps().V1().ReplicaSets().Informer()
	deps.InformerFactory = factory
}

func newSingleKindCatalog(deps Dependencies, desc Descriptor) *Service {
	svc := NewService(deps, nil)
	svc.discoveryClient = &stubDiscovery{lists: []*metav1.APIResourceList{{
		GroupVersion: desc.Group + "/" + desc.Version,
		APIResources: []metav1.APIResource{{Name: desc.Resource, Kind: desc.Kind, Namespaced: desc.Namespaced, Verbs: []string{"list", "watch"}}},
	}}}
	return svc
}
