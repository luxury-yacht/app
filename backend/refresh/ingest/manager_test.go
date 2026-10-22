package ingest

import (
	"context"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/stretchr/testify/require"
)

func TestProjectionForIncludesDescriptorAggregate(t *testing.T) {
	descriptor := streamspec.Descriptor{
		StreamRow: func(_ streamrows.ClusterMeta, obj metav1.Object) any {
			return tableRow{NS: obj.GetNamespace(), Name: obj.GetName()}
		},
		AggregateRow: func(obj metav1.Object) any {
			return aggregateRow{Key: obj.GetNamespace() + "/" + obj.GetName()}
		},
	}
	project := projectionFor(streamrows.ClusterMeta{ClusterID: "cluster-a"}, &entry{desc: descriptor})

	raw, err := project(&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "quota", Namespace: "team-a"}})
	require.NoError(t, err)
	bundle := raw.(Bundle)
	require.Equal(t, aggregateRow{Key: "team-a/quota"}, bundle.Aggregate)
}

// The manager builds reflectors only for kinds in kindregistry.StreamDescriptors().
// That list is the directly-streamed "summary table" kinds (ConfigMap, RBAC,
// quotas, storage, network, …); it deliberately excludes workload/topology kinds
// like Deployment, Pod, and Node, which are streamed by a different mechanism. So
// the convergence tests seed kinds that ARE in the streamed registry.
var (
	configMapGVR      = schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	serviceAccountGVR = schema.GroupVersionResource{Version: "v1", Resource: "serviceaccounts"}
	roleGVR           = schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}

	testMeta = streamrows.ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
)

func newCM(ns, name string) *corev1.ConfigMap {
	return &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}}
}

func newServiceAccount(ns, name string) *corev1.ServiceAccount {
	return &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}}
}

func newRole(ns, name string) *rbacv1.Role {
	return &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}}
}

// storeNames returns the sorted "namespace/name" identity of every projected row
// in a store, derived from the bundle's Table half (the stream Summary) via JSON
// so the helper stays kind-agnostic.
// storeNames returns the identity (namespace/name, or name for cluster-scoped) of every
// object in the store. It reads ListKeys — the cache key cache.MetaNamespaceKeyFunc set at
// intake, which is exactly that identity — rather than the Table half, because the store now
// drops the redundant Table half from its stored bundles (the maintained store holds it
// columnar). A key is present only when projection succeeded, so it still proves the
// projection ran for the kind.
func storeNames(t *testing.T, store *ProjectingStore) []string {
	t.Helper()
	out := append([]string(nil), store.ListKeys()...)
	sort.Strings(out)
	return out
}

func waitForNames(t *testing.T, store *ProjectingStore, want []string) []string {
	t.Helper()
	sort.Strings(want)
	deadline := time.Now().Add(5 * time.Second)
	var last []string
	for time.Now().Before(deadline) {
		last = storeNames(t, store)
		if equalStrings(last, want) {
			return last
		}
		time.Sleep(10 * time.Millisecond)
	}
	return last
}

func waitForManagerSynced(t *testing.T, m *IngestManager) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if m.HasSynced() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("ingest manager never reported HasSynced")
}

// TestIngestManagerStoresHoldProjectedSummaries is the load-bearing test: it runs
// the real manager (NewListWatchFromClient over real rest clients, WatchList
// negotiation included) against a tracker-backed API server and proves each kind's
// store converges to projected stream Summaries — never typed objects.
func TestIngestManagerStoresHoldProjectedSummaries(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	server.Create(t, newCM("default", "seed-cm"))
	server.Create(t, newCM("other", "second-cm"))
	server.Create(t, newServiceAccount("default", "seed-sa"))
	server.Create(t, newRole("default", "seed-role"))

	kube := server.Client(t)

	mgr := NewIngestManager(testMeta, kube, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)

	waitForManagerSynced(t, mgr)

	cmStore := mgr.StoreFor(configMapGVR)
	if cmStore == nil {
		t.Fatal("no store for configmaps")
	}
	if got := waitForNames(t, cmStore, []string{"default/seed-cm", "other/second-cm"}); !equalStrings(got, []string{"default/seed-cm", "other/second-cm"}) {
		t.Fatalf("configmap store names = %v", got)
	}
	// The stored values must be projected Bundles, never the typed *corev1.ConfigMap. The
	// store drops the redundant Table half (the maintained store holds it columnar), so the
	// stored bundle no longer carries the ConfigSummary — but the invariant that matters,
	// "never the source object", still holds and is asserted here.
	for _, row := range cmStore.List() {
		if _, isCM := row.(*corev1.ConfigMap); isCM {
			t.Fatalf("configmap store retained a *corev1.ConfigMap; only the projected bundle must be kept")
		}
		if _, isBundle := row.(Bundle); !isBundle {
			t.Fatalf("configmap store row is %T, want ingest.Bundle", row)
		}
	}

	saStore := mgr.StoreFor(serviceAccountGVR)
	if saStore == nil {
		t.Fatal("no store for serviceaccounts")
	}
	if got := waitForNames(t, saStore, []string{"default/seed-sa"}); !equalStrings(got, []string{"default/seed-sa"}) {
		t.Fatalf("serviceaccount store names = %v", got)
	}
	for _, row := range saStore.List() {
		if _, isSA := row.(*corev1.ServiceAccount); isSA {
			t.Fatalf("serviceaccount store retained a *corev1.ServiceAccount; only the projected bundle must be kept")
		}
		if _, isBundle := row.(Bundle); !isBundle {
			t.Fatalf("serviceaccount store row is %T, want ingest.Bundle", row)
		}
	}

	roleStore := mgr.StoreFor(roleGVR)
	if roleStore == nil {
		t.Fatal("no store for roles")
	}
	if got := waitForNames(t, roleStore, []string{"default/seed-role"}); !equalStrings(got, []string{"default/seed-role"}) {
		t.Fatalf("role store names = %v", got)
	}
	for _, row := range roleStore.List() {
		if _, isRole := row.(*rbacv1.Role); isRole {
			t.Fatalf("role store retained a *rbacv1.Role; only the projected bundle must be kept")
		}
	}
}

// TestIngestManagerConvergesOnCreateAndDelete proves the watch path keeps the
// projected store in sync: a create lands as a new summary and a delete evicts it.
func TestIngestManagerConvergesOnCreateAndDelete(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	server.Create(t, newCM("default", "seed-cm"))

	kube := server.Client(t)

	mgr := NewIngestManager(testMeta, kube, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	cmStore := mgr.StoreFor(configMapGVR)
	if got := waitForNames(t, cmStore, []string{"default/seed-cm"}); !equalStrings(got, []string{"default/seed-cm"}) {
		t.Fatalf("initial configmap names = %v", got)
	}

	// Create via the tracker; the watch must deliver it as a new projected row.
	server.Create(t, newCM("default", "added-cm"))
	want := []string{"default/added-cm", "default/seed-cm"}
	if got := waitForNames(t, cmStore, want); !equalStrings(got, want) {
		t.Fatalf("after create, configmap names = %v, want %v", got, want)
	}

	// Delete via the tracker; the watch delete must evict the projected row.
	server.Delete(t, newCM("default", "seed-cm"))
	want = []string{"default/added-cm"}
	if got := waitForNames(t, cmStore, want); !equalStrings(got, want) {
		t.Fatalf("after delete, configmap names = %v, want %v", got, want)
	}
}

// TestIngestManagerStopHaltsReflectorsNoLeak proves Stop (and ctx cancel) wind the
// reflectors down with no leaked goroutines.
func TestIngestManagerStopHaltsReflectorsNoLeak(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	server.Create(t, newCM("default", "seed-cm"))
	kube := server.Client(t)

	before := runtime.NumGoroutine()

	mgr := NewIngestManager(testMeta, kube, nil, nil)
	ctx := context.Background()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	mgr.Stop()

	// After Stop every reflector goroutine must wind down to the baseline.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if runtime.NumGoroutine() <= before {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("goroutine count did not return to baseline after Stop: before=%d after=%d", before, runtime.NumGoroutine())
}

// TestRestClientForMapsEveryStreamedBuiltinGroup pins the group/version ->
// RESTClient mapping: every streamed built-in descriptor (the ones the client-go
// scheme knows) must resolve to a non-nil REST client, and a nil Gateway/apiext
// client must make those groups resolve to (nil, false) so the kind is skipped.
func TestRestClientForMapsEveryStreamedBuiltinGroup(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	kube := server.Client(t)

	mgr := NewIngestManager(testMeta, kube, nil, nil)
	for _, d := range kindregistry.StreamDescriptors() {
		gvk := schema.GroupVersionKind{Group: d.Group, Version: d.Version, Kind: d.Kind}
		_, schemeErr := clientgoscheme.Scheme.New(gvk)
		schemeKnows := schemeErr == nil
		client, ok := mgr.restClientFor(d.Group, d.Version)
		switch d.Group {
		case gatewayGroup, apiextensionsGroup:
			// No Gateway/apiext client supplied: these groups must be skipped.
			if ok {
				t.Fatalf("restClientFor(%q) returned a client despite a nil group client", d.Group)
			}
		default:
			if !ok || client == nil {
				t.Fatalf("restClientFor(%q/%q) returned no client for built-in kind %s", d.Group, d.Version, d.Kind)
			}
			if schemeKnows {
				// Every built-in the manager builds must also be served by the test
				// route table, otherwise its reflector could never sync.
				if gvr := (schema.GroupVersionResource{Group: d.Group, Version: d.Version, Resource: d.Resource}); !server.Serves(gvr) {
					t.Fatalf("built-in kind %s has no route in the test server", gvr)
				}
			}
		}
	}
}

// TestExampleObjectForResolvesBuiltinsAndSkipsUnknown pins exampleObjectFor: the
// client-go scheme instantiates every built-in streamed kind, and an unknown GVK
// reports false so the manager skips it rather than feeding the reflector a nil
// example.
func TestExampleObjectForResolvesBuiltinsAndSkipsUnknown(t *testing.T) {
	for _, d := range kindregistry.StreamDescriptors() {
		if d.Group == gatewayGroup {
			continue // served by the gateway scheme, exercised only when a client is present
		}
		gvk := schema.GroupVersionKind{Group: d.Group, Version: d.Version, Kind: d.Kind}
		obj, ok := exampleObjectFor(gvk)
		if !ok || obj == nil {
			t.Fatalf("exampleObjectFor(%s) failed for a built-in kind", gvk)
		}
	}
	if _, ok := exampleObjectFor(schema.GroupVersionKind{Group: "example.com", Version: "v9", Kind: "Nonexistent"}); ok {
		t.Fatal("exampleObjectFor reported an unknown GVK as known")
	}
}

// TestIngestManagerStreamRowRunsForEveryBuiltinKind seeds exactly one object of
// every built-in streamed kind and asserts every store ends up with one projected
// summary. This proves the kind's StreamRow projection runs over the
// reflector-decoded typed object for every kind — the assertion in each StreamRow
// closure matches the type the reflector decodes — not just the three spot-checked
// kinds. A kind whose StreamRow could not run would leave its store empty (the
// projection error is logged and skipped) and fail the per-store assertion.
func TestIngestManagerStreamRowRunsForEveryBuiltinKind(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	// Seed one object per routed built-in kind, derived from the same route table
	// the manager's registry loop produces — no per-kind code.
	seeded := make(map[schema.GroupVersionResource]string)
	for _, route := range server.Routes() {
		obj, err := server.NewObject(route.ItemGVK)
		if err != nil {
			t.Fatalf("new %s: %v", route.ItemGVK, err)
		}
		accessor, err := apimeta.Accessor(obj)
		if err != nil {
			t.Fatalf("accessor for %s: %v", route.ItemGVK, err)
		}
		name := "seed-" + strings.ToLower(route.ItemGVK.Kind)
		accessor.SetName(name)
		// Namespaced kinds need a namespace; cluster-scoped kinds must have none.
		ns := ""
		if isNamespacedRoute(route.GVR) {
			ns = "default"
			accessor.SetNamespace(ns)
		}
		server.Create(t, obj)
		identity := name
		if ns != "" {
			identity = ns + "/" + name
		}
		seeded[route.GVR] = identity
	}

	mgr := NewIngestManager(testMeta, server.Client(t), server.APIExtensionsClient(t), nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	for gvr, identity := range seeded {
		store := mgr.StoreFor(gvr)
		if store == nil {
			t.Fatalf("no store for %s", gvr)
		}
		if got := waitForNames(t, store, []string{identity}); !equalStrings(got, []string{identity}) {
			t.Fatalf("%s store projected names = %v, want [%s] (StreamRow may not have run for this kind)", gvr.Resource, got, identity)
		}
	}
}

// isNamespacedRoute reports whether the resource is namespaced, looked up from the
// streamed registry's ClusterScoped flag so the test stays registry-driven.
func isNamespacedRoute(gvr schema.GroupVersionResource) bool {
	for _, d := range kindregistry.StreamDescriptors() {
		if d.Group == gvr.Group && d.Version == gvr.Version && d.Resource == gvr.Resource {
			return !d.ClusterScoped
		}
	}
	return true
}

// TestRestClientForHonoursVersionAndOptionalClients pins the version-specific and
// optional-client branches: autoscaling v1 and v2 resolve to different clients;
// an unknown group resolves to (nil, false); and the Gateway/apiext groups resolve
// only when their client is supplied.
func TestRestClientForHonoursVersionAndOptionalClients(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	cfg := server.Config()
	kube, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		t.Fatalf("kube client: %v", err)
	}
	apiext, err := apiextensionsclientset.NewForConfig(cfg)
	if err != nil {
		t.Fatalf("apiext client: %v", err)
	}
	gateway, err := gatewayversioned.NewForConfig(cfg)
	if err != nil {
		t.Fatalf("gateway client: %v", err)
	}

	withClients := NewIngestManager(testMeta, kube, apiext, &GatewaySource{Client: gateway, Presence: servedGatewayKinds{"Gateway": {}}})
	v1Client, ok := withClients.restClientFor("autoscaling", "v1")
	if !ok || v1Client == nil {
		t.Fatal("autoscaling/v1 resolved no client")
	}
	v2Client, ok := withClients.restClientFor("autoscaling", "v2")
	if !ok || v2Client == nil {
		t.Fatal("autoscaling/v2 resolved no client")
	}
	if v1Client == v2Client {
		t.Fatal("autoscaling v1 and v2 must resolve to different REST clients")
	}
	if c, ok := withClients.restClientFor(gatewayGroup, "v1"); !ok || c == nil {
		t.Fatal("gateway group resolved no client despite a gateway client being supplied")
	}
	if c, ok := withClients.restClientFor(apiextensionsGroup, "v1"); !ok || c == nil {
		t.Fatal("apiextensions group resolved no client despite an apiext client being supplied")
	}
	if _, ok := withClients.restClientFor("example.com", "v1"); ok {
		t.Fatal("unknown group must resolve to no client")
	}

	noOptional := NewIngestManager(testMeta, kube, nil, nil)
	if _, ok := noOptional.restClientFor(gatewayGroup, "v1"); ok {
		t.Fatal("nil gateway client must resolve gateway group to no client")
	}
	if _, ok := noOptional.restClientFor(apiextensionsGroup, "v1"); ok {
		t.Fatal("nil apiext client must resolve apiextensions group to no client")
	}
}

// servedGatewayKinds is the Gateway kinds discovery reported as served.
type servedGatewayKinds map[string]struct{}

func (s servedGatewayKinds) Has(kind string) bool {
	_, ok := s[kind]
	return ok
}

// A partial Gateway API install must not get a reflector for a kind the
// server does not serve: it would LIST a 404 forever and report the kind as
// unavailable instead of absent.
func TestGatewayKindsGetSourcesOnlyWhenServed(t *testing.T) {
	cfg := &rest.Config{Host: "http://127.0.0.1:1"}
	kube, err := kubernetes.NewForConfig(cfg)
	require.NoError(t, err)
	gateway, err := gatewayversioned.NewForConfig(cfg)
	require.NoError(t, err)

	mgr := NewIngestManager(testMeta, kube, nil, &GatewaySource{
		Client:   gateway,
		Presence: servedGatewayKinds{"Gateway": {}, "HTTPRoute": {}},
	})

	served := schema.GroupVersionResource{Group: gatewayGroup, Version: "v1", Resource: "httproutes"}
	unserved := schema.GroupVersionResource{Group: gatewayGroup, Version: "v1", Resource: "listenersets"}
	require.True(t, mgr.Tracks(served), "a served Gateway kind gets a source")
	require.False(t, mgr.Tracks(unserved), "an unserved Gateway kind gets no source")
	require.Nil(t, mgr.StoreFor(unserved))
}

// TestExampleObjectForUsesGatewaySchemeFallback pins the Gateway-scheme fallback:
// Gateway kinds the client-go scheme does not know are instantiated from the
// Gateway API scheme instead.
func TestExampleObjectForUsesGatewaySchemeFallback(t *testing.T) {
	gwGVK := schema.GroupVersionKind{Group: gatewayGroup, Version: "v1", Kind: "Gateway"}
	if _, err := clientgoscheme.Scheme.New(gwGVK); err == nil {
		t.Skip("client-go scheme unexpectedly knows the Gateway kind; fallback path not exercised")
	}
	obj, ok := exampleObjectFor(gwGVK)
	if !ok || obj == nil {
		t.Fatal("exampleObjectFor did not fall back to the Gateway scheme for a Gateway kind")
	}
}

// TestInitialSyncDurationsRecordPerKindRelistTime pins the per-GVR cold-start
// telemetry: after the manager syncs, every synced kind reports how long its initial
// relist took from Start — the measurement needed to name the kinds that dominate the
// 10s+ first-connect window on real clusters.
func TestInitialSyncDurationsRecordPerKindRelistTime(t *testing.T) {
	server := ingesttest.NewAPIServer(t)
	server.Create(t, newCM("default", "seed-cm"))

	kube := server.Client(t)

	mgr := NewIngestManager(testMeta, kube, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	durations := mgr.InitialSyncDurations()
	d, ok := durations[configMapGVR]
	if !ok {
		t.Fatalf("no initial-sync duration recorded for configmaps, got %v", durations)
	}
	if d <= 0 || d > time.Minute {
		t.Fatalf("implausible initial-sync duration for configmaps: %v", d)
	}
}
