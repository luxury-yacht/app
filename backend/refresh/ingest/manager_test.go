package ingest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
)

// trackerAPIServer is a minimal Kubernetes-shaped API server backed by a
// client-go ObjectTracker. It serves LIST and WatchList (sendInitialEvents)
// requests for every built-in streamed kind generically — there is no per-kind
// code; the GVK for a path is looked up from the registry-derived route table.
// It exists so the production ingest manager (NewListWatchFromClient over a real
// rest.RESTClient, which negotiates WatchList) can be exercised end-to-end. A
// fake.NewClientset cannot back this path: its RESTClient panics when used.
type trackerAPIServer struct {
	tracker clienttesting.ObjectTracker
	// routes maps "group/version/resource" to the kind's list/item GVKs.
	routes map[string]routeGVK
}

type routeGVK struct {
	gvr     schema.GroupVersionResource
	itemGVK schema.GroupVersionKind
}

// newTrackerAPIServer builds the route table from the same registry the manager
// loops, restricted to the built-in kinds the manager's restClientFor can serve
// without a Gateway/apiext client (the ones a (kube, nil, nil) manager builds).
func newTrackerAPIServer(t *testing.T) *trackerAPIServer {
	t.Helper()
	tracker := clienttesting.NewObjectTracker(clientgoscheme.Scheme, clientgoscheme.Codecs.UniversalDecoder())
	routes := make(map[string]routeGVK)
	for _, d := range kindregistry.StreamDescriptors() {
		gvk := schema.GroupVersionKind{Group: d.Group, Version: d.Version, Kind: d.Kind}
		// Only routes the client-go scheme knows (the built-ins); Gateway kinds are
		// served by a different client and are not built by a (kube, nil, nil)
		// manager, so they never reach this server.
		if _, err := clientgoscheme.Scheme.New(gvk); err != nil {
			continue
		}
		key := d.Group + "/" + d.Version + "/" + d.Resource
		routes[key] = routeGVK{
			gvr:     schema.GroupVersionResource{Group: d.Group, Version: d.Version, Resource: d.Resource},
			itemGVK: gvk,
		}
	}
	return &trackerAPIServer{tracker: tracker, routes: routes}
}

// routeFor parses a REST path into its group/version/resource/namespace and
// returns the matching route. Paths are the standard /api/v1/... (core) and
// /apis/<group>/<version>/... shapes NewListWatchFromClient generates.
func (s *trackerAPIServer) routeFor(path string) (routeGVK, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	var group, version, resource, ns string
	switch {
	case len(parts) >= 3 && parts[0] == "api":
		version = parts[1]
		rest := parts[2:]
		if len(rest) >= 3 && rest[0] == "namespaces" {
			ns, resource = rest[1], rest[2]
		} else {
			resource = rest[0]
		}
	case len(parts) >= 4 && parts[0] == "apis":
		group, version = parts[1], parts[2]
		rest := parts[3:]
		if len(rest) >= 3 && rest[0] == "namespaces" {
			ns, resource = rest[1], rest[2]
		} else {
			resource = rest[0]
		}
	default:
		return routeGVK{}, "", false
	}
	r, ok := s.routes[group+"/"+version+"/"+resource]
	return r, ns, ok
}

func (s *trackerAPIServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	route, ns, ok := s.routeFor(r.URL.Path)
	if !ok {
		http.Error(w, "unknown resource: "+r.URL.Path, http.StatusNotFound)
		return
	}
	enc := clientgoscheme.Codecs.LegacyCodec(route.itemGVK.GroupVersion())
	if r.URL.Query().Get("watch") != "true" {
		s.serveList(w, route, ns, enc)
		return
	}
	s.serveWatch(w, r, route, ns, enc)
}

func (s *trackerAPIServer) serveList(w http.ResponseWriter, route routeGVK, ns string, enc apiruntime.Encoder) {
	list, err := s.tracker.List(route.gvr, route.itemGVK, ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	data, err := apiruntime.Encode(enc, list)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

// serveWatch serves both a plain WATCH and a WatchList (sendInitialEvents=true).
// For a WatchList it streams the current set as ADDED events followed by a
// BOOKMARK carrying the k8s.io/initial-events-end annotation — the signal the
// reflector waits for to mark its store synced — then streams live tracker
// events. For application/json the watch frames are concatenated WatchEvent JSON
// objects, exactly what the rest client's stream watcher decodes.
func (s *trackerAPIServer) serveWatch(w http.ResponseWriter, r *http.Request, route routeGVK, ns string, enc apiruntime.Encoder) {
	wi, err := s.tracker.Watch(route.gvr, ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer wi.Stop()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	writeEvent := func(t watch.EventType, obj apiruntime.Object) bool {
		raw, encErr := apiruntime.Encode(enc, obj)
		if encErr != nil {
			return false
		}
		event := metav1.WatchEvent{Type: string(t), Object: apiruntime.RawExtension{Raw: raw}}
		b, mErr := json.Marshal(event)
		if mErr != nil {
			return false
		}
		if _, wErr := w.Write(b); wErr != nil {
			return false
		}
		if flusher != nil {
			flusher.Flush()
		}
		return true
	}

	if r.URL.Query().Get("sendInitialEvents") == "true" {
		list, listErr := s.tracker.List(route.gvr, route.itemGVK, ns)
		if listErr != nil {
			return
		}
		items, _ := apimeta.ExtractList(list)
		for _, item := range items {
			if !writeEvent(watch.Added, item) {
				return
			}
		}
		if !writeEvent(watch.Bookmark, s.initialEventsEndBookmark(route, list)) {
			return
		}
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, open := <-wi.ResultChan():
			if !open {
				return
			}
			if !writeEvent(ev.Type, ev.Object) {
				return
			}
		}
	}
}

// initialEventsEndBookmark builds the terminal WatchList bookmark: an empty typed
// object of the kind carrying the list's resourceVersion and the
// k8s.io/initial-events-end annotation that tells the reflector the initial set
// is complete.
func (s *trackerAPIServer) initialEventsEndBookmark(route routeGVK, list apiruntime.Object) apiruntime.Object {
	obj, err := clientgoscheme.Scheme.New(route.itemGVK)
	if err != nil {
		return nil
	}
	accessor, err := apimeta.Accessor(obj)
	if err != nil {
		return nil
	}
	if listMeta, lErr := apimeta.ListAccessor(list); lErr == nil {
		accessor.SetResourceVersion(listMeta.GetResourceVersion())
	}
	accessor.SetAnnotations(map[string]string{"k8s.io/initial-events-end": "true"})
	return obj
}

// add seeds (or live-creates) one object in the tracker, stamping the TypeMeta
// the LIST/WATCH encoders rely on.
func (s *trackerAPIServer) add(t *testing.T, obj apiruntime.Object, gvk schema.GroupVersionKind) {
	t.Helper()
	obj.GetObjectKind().SetGroupVersionKind(gvk)
	if err := s.tracker.Add(obj); err != nil {
		t.Fatalf("tracker.Add: %v", err)
	}
}

func newKubeClientFor(t *testing.T, server *httptest.Server) kubernetes.Interface {
	t.Helper()
	kube, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	if err != nil {
		t.Fatalf("kubernetes.NewForConfig: %v", err)
	}
	return kube
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

	configMapGVK      = schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}
	serviceAccountGVK = schema.GroupVersionKind{Version: "v1", Kind: "ServiceAccount"}
	roleGVK           = schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role"}

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
	server := newTrackerAPIServer(t)
	server.add(t, newCM("default", "seed-cm"), configMapGVK)
	server.add(t, newCM("other", "second-cm"), configMapGVK)
	server.add(t, newServiceAccount("default", "seed-sa"), serviceAccountGVK)
	server.add(t, newRole("default", "seed-role"), roleGVK)

	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

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
	server := newTrackerAPIServer(t)
	server.add(t, newCM("default", "seed-cm"), configMapGVK)

	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

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
	server.add(t, newCM("default", "added-cm"), configMapGVK)
	want := []string{"default/added-cm", "default/seed-cm"}
	if got := waitForNames(t, cmStore, want); !equalStrings(got, want) {
		t.Fatalf("after create, configmap names = %v, want %v", got, want)
	}

	// Delete via the tracker; the watch delete must evict the projected row.
	if err := server.tracker.Delete(configMapGVR, "default", "seed-cm"); err != nil {
		t.Fatalf("tracker.Delete: %v", err)
	}
	want = []string{"default/added-cm"}
	if got := waitForNames(t, cmStore, want); !equalStrings(got, want) {
		t.Fatalf("after delete, configmap names = %v, want %v", got, want)
	}
}

// TestIngestManagerStopHaltsReflectorsNoLeak proves Stop (and ctx cancel) wind the
// reflectors down with no leaked goroutines.
func TestIngestManagerStopHaltsReflectorsNoLeak(t *testing.T) {
	server := newTrackerAPIServer(t)
	server.add(t, newCM("default", "seed-cm"), configMapGVK)
	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

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
	server := newTrackerAPIServer(t)
	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

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
				key := d.Group + "/" + d.Version + "/" + d.Resource
				if _, routed := server.routes[key]; !routed {
					t.Fatalf("built-in kind %s has no route in the test server", key)
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
	server := newTrackerAPIServer(t)
	// Seed one object per routed built-in kind, derived from the same route table
	// the manager's registry loop produces — no per-kind code.
	seeded := make(map[schema.GroupVersionResource]string)
	for _, route := range server.routes {
		obj, err := clientgoscheme.Scheme.New(route.itemGVK)
		if err != nil {
			t.Fatalf("scheme.New(%s): %v", route.itemGVK, err)
		}
		accessor, err := apimeta.Accessor(obj)
		if err != nil {
			t.Fatalf("accessor for %s: %v", route.itemGVK, err)
		}
		name := "seed-" + strings.ToLower(route.itemGVK.Kind)
		accessor.SetName(name)
		// Namespaced kinds need a namespace; cluster-scoped kinds must have none.
		ns := ""
		if isNamespacedRoute(route.gvr) {
			ns = "default"
			accessor.SetNamespace(ns)
		}
		server.add(t, obj, route.itemGVK)
		identity := name
		if ns != "" {
			identity = ns + "/" + name
		}
		seeded[route.gvr] = identity
	}

	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

	mgr := NewIngestManager(testMeta, kube, nil, nil)
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
	server := newTrackerAPIServer(t)
	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	cfg := &rest.Config{Host: httpSrv.URL}
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

	withClients := NewIngestManager(testMeta, kube, apiext, gateway)
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
