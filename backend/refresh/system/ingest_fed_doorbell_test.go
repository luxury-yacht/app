package system

import (
	"context"
	"reflect"
	"slices"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/release"
	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

var (
	roleBindingGVR   = rbacv1.SchemeGroupVersion.WithResource("rolebindings")
	deploymentGVR    = appsv1.SchemeGroupVersion.WithResource("deployments")
	nodeGVR          = corev1.SchemeGroupVersion.WithResource("nodes")
	serviceGVR       = corev1.SchemeGroupVersion.WithResource("services")
	endpointSliceGVR = discoveryv1.SchemeGroupVersion.WithResource("endpointslices")
	podGVR           = corev1.SchemeGroupVersion.WithResource("pods")
	eventGVR         = corev1.SchemeGroupVersion.WithResource("events")
	configMapGVR     = corev1.SchemeGroupVersion.WithResource("configmaps")
	accountGVR       = corev1.SchemeGroupVersion.WithResource("serviceaccounts")
	replicaSetGVR    = appsv1.SchemeGroupVersion.WithResource("replicasets")
)

// ingestHarness is the production subsystem with its owned ingest stores
// driven through the reflector's own entry points (cache.Store Add, Update,
// Delete, and partition Replace), so ordering is deterministic and every
// production sink, store, and doorbell is in the path.
type ingestHarness struct {
	subsystem *Subsystem
	kube      *fake.Clientset
}

func newIngestHarness(t *testing.T, allowedNamespaces ...string) *ingestHarness {
	t.Helper()
	return newIngestHarnessDenying(t, nil, allowedNamespaces...)
}

// newIngestHarnessDenying is newIngestHarness for an identity that may not
// read the denied core resources.
func newIngestHarnessDenying(t *testing.T, denied []string, allowedNamespaces ...string) *ingestHarness {
	t.Helper()
	return newIngestHarnessReviewing(t, func(attrs authorizationv1.ResourceAttributes) bool {
		return !(attrs.Group == "" && slices.Contains(denied, attrs.Resource))
	}, allowedNamespaces...)
}

// newIngestHarnessReviewing is newIngestHarness for an identity whose access
// reviews allow decides.
func newIngestHarnessReviewing(t *testing.T, allow func(authorizationv1.ResourceAttributes) bool, allowedNamespaces ...string) *ingestHarness {
	t.Helper()
	kube := fake.NewClientset()
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		attrs := review.Spec.ResourceAttributes
		// No metrics API in this harness: leave the poller disabled.
		review.Status.Allowed = attrs != nil && attrs.Group != "metrics.k8s.io" && allow(*attrs)
		return true, review, nil
	})
	subsystem, err := NewSubsystemWithServices(t.Context(), Config{
		KubernetesClient: kube, APIExtensionsClient: apiextensionsfake.NewClientset(),
		DynamicClient: dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()), ClusterID: "c1",
		Logger: applog.Noop, ObjectDetailsProvider: noopObjectDetailProvider{},
		NodeMaintenanceStore: nodemaintenance.NewStore(5),
		AllowedNamespaces:    allowedNamespaces,
		GatewayClient:        gatewayfake.NewSimpleClientset(), //nolint:staticcheck // the harness never runs reflectors
		GatewayAPIPresence:   everyGatewayKind{},
	})
	require.NoError(t, err)
	t.Cleanup(subsystem.ResourceStream.Stop)
	// The reflectors never run; mark each owned store synced so builds serve it.
	for _, descriptor := range kindregistry.All {
		if store := subsystem.IngestManager.StoreFor(descriptor.Identity.GVR()); store != nil {
			store.MarkSynced()
		}
	}
	return &ingestHarness{subsystem: subsystem, kube: kube}
}

// everyGatewayKind is a cluster that serves every Gateway API kind.
type everyGatewayKind struct{}

func (everyGatewayKind) AnyPresent() bool   { return true }
func (everyGatewayKind) Has(string) bool    { return true }
func (everyGatewayKind) Absent(string) bool { return false }

func (h *ingestHarness) store(t *testing.T, gvr schema.GroupVersionResource) *ingest.ProjectingStore {
	t.Helper()
	store := h.subsystem.IngestManager.StoreFor(gvr)
	require.NotNil(t, store, "no ingest store for %s", gvr)
	return store
}

func (h *ingestHarness) subscribe(t *testing.T, domainName, scope string) *resourcestream.Subscription {
	t.Helper()
	selector, err := resourcestream.ParseStreamSelector("c1", domainName, scope)
	require.NoError(t, err)
	sub, err := h.subsystem.ResourceStream.SubscribeSelector(selector)
	require.NoError(t, err)
	t.Cleanup(sub.Cancel)
	return sub
}

func (h *ingestHarness) rowNames(t *testing.T, domainName, scope string) []string {
	t.Helper()
	snap, err := h.subsystem.SnapshotService.Build(context.Background(), domainName, "c1|"+scope)
	require.NoError(t, err)
	rows := reflect.ValueOf(snap.Payload).FieldByName("Rows")
	require.True(t, rows.IsValid(), "payload %T has no rows", snap.Payload)
	names := make([]string, 0, rows.Len())
	for i := 0; i < rows.Len(); i++ {
		row := rows.Index(i)
		if ref := row.FieldByName("Ref"); ref.IsValid() {
			names = append(names, ref.FieldByName("Name").String())
			continue
		}
		names = append(names, row.FieldByName("Name").String())
	}
	sort.Strings(names)
	return names
}

// collect gathers every doorbell on the subscription for the window.
func collect(sub *resourcestream.Subscription, window time.Duration) int {
	count := 0
	deadline := time.After(window)
	for {
		select {
		case <-sub.Updates:
			count++
		case <-deadline:
			return count
		}
	}
}

// writeHold is a catalog sink added after production's catalog sinks. Every
// catalog sink runs before the maintained stores' bundle sinks, so while it
// holds, a store write has started but no bundle-fed store has applied it.
type writeHold struct {
	armed   atomic.Bool
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func newWriteHold() *writeHold {
	return &writeHold{entered: make(chan struct{}, 8), release: make(chan struct{})}
}

func (w *writeHold) hold() {
	if w.armed.CompareAndSwap(true, false) {
		w.entered <- struct{}{}
		<-w.release
	}
}
func (w *writeHold) Upsert(interface{}) { w.hold() }
func (w *writeHold) Delete(interface{}) { w.hold() }
func (w *writeHold) unblock()           { w.once.Do(func() { close(w.release) }) }

func markDeleting(meta *metav1.ObjectMeta, deleting bool) {
	if !deleting {
		return
	}
	now := metav1.Now()
	meta.DeletionTimestamp = &now
	meta.Finalizers = []string{"test.example/hold"}
}

func crdObject(name, rv string, deleting bool) *apiextv1.CustomResourceDefinition {
	crd := &apiextv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv, UID: types.UID("uid-" + name)},
		Spec: apiextv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextv1.CustomResourceDefinitionNames{Plural: "widgets", Kind: "Widget"},
			Scope: apiextv1.NamespaceScoped,
			Versions: []apiextv1.CustomResourceDefinitionVersion{{
				Name: "v1", Served: true, Storage: true,
			}},
		},
	}
	markDeleting(&crd.ObjectMeta, deleting)
	return crd
}

type ingestFedCase struct {
	name     string
	gvr      schema.GroupVersionResource
	domain   string
	scope    string
	rowName  string
	object   func(rv string, deleting bool) interface{}
	derived  []struct{ domain, scope string }
	heldRing bool // false when the store is a table sink, which runs before the hold
	// ringWindow is how long a step waits for its doorbell; Event tables
	// debounce their rings.
	ringWindow time.Duration
}

func ingestFedCases() []ingestFedCase {
	meta := func(name, namespace, rv string, deleting bool) metav1.ObjectMeta {
		m := metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, UID: types.UID("uid-" + name)}
		markDeleting(&m, deleting)
		return m
	}
	return []ingestFedCase{
		{
			name: "RoleBinding", gvr: roleBindingGVR, domain: "namespace-rbac", scope: "namespace:team-a", rowName: "readers", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &rbacv1.RoleBinding{ObjectMeta: meta("readers", "team-a", rv, deleting),
					Subjects: []rbacv1.Subject{{Kind: "User", APIGroup: rbacv1.GroupName, Name: "alice"}},
					RoleRef:  rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"}}
			},
			derived: []struct{ domain, scope string }{{"cluster-identities", ""}},
		},
		{
			name: "Deployment", gvr: deploymentGVR, domain: "namespace-workloads", scope: "namespace:team-a", rowName: "web", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &appsv1.Deployment{ObjectMeta: meta("web", "team-a", rv, deleting)}
			},
		},
		{
			name: "Node", gvr: nodeGVR, domain: "nodes", scope: "", rowName: "node-a", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &corev1.Node{ObjectMeta: meta("node-a", "", rv, deleting)}
			},
		},
		{
			name: "Service", gvr: serviceGVR, domain: "namespace-network", scope: "namespace:team-a", rowName: "api", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &corev1.Service{ObjectMeta: meta("api", "team-a", rv, deleting)}
			},
		},
		{
			name: "EndpointSlice", gvr: endpointSliceGVR, domain: "namespace-network", scope: "namespace:team-a", rowName: "api-x1", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &discoveryv1.EndpointSlice{ObjectMeta: meta("api-x1", "team-a", rv, deleting), AddressType: discoveryv1.AddressTypeIPv4}
			},
		},
		{
			name: "HTTPRoute", gvr: schema.GroupVersionResource{Group: gatewayv1.GroupName, Version: "v1", Resource: "httproutes"}, domain: "namespace-network", scope: "namespace:team-a", rowName: "web-route", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &gatewayv1.HTTPRoute{ObjectMeta: meta("web-route", "team-a", rv, deleting)}
			},
		},
		{
			name: "GatewayClass", gvr: schema.GroupVersionResource{Group: gatewayv1.GroupName, Version: "v1", Resource: "gatewayclasses"}, domain: "cluster-config", scope: "", rowName: "edge", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &gatewayv1.GatewayClass{ObjectMeta: meta("edge", "", rv, deleting), Spec: gatewayv1.GatewayClassSpec{ControllerName: "example.com/gateway"}}
			},
		},
		{
			name: "HorizontalPodAutoscaler", gvr: autoscalingv2.SchemeGroupVersion.WithResource("horizontalpodautoscalers"), domain: "namespace-autoscaling", scope: "namespace:team-a", rowName: "web-hpa", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				return &autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: meta("web-hpa", "team-a", rv, deleting), Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
					ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"}, MaxReplicas: 3,
				}}
			},
			// The workloads table joins each row's HPA at serve.
			derived: []struct{ domain, scope string }{{"namespace-workloads", "namespace:team-a"}},
		},
		{
			name: "CustomResourceDefinition", gvr: apiextensions.Identity.GVR(), domain: "cluster-crds", scope: "", rowName: "widgets.example.com", heldRing: true,
			object: func(rv string, deleting bool) interface{} { return crdObject("widgets.example.com", rv, deleting) },
		},
		{
			name: "Helm release", gvr: secretGVR, domain: "namespace-helm", scope: "namespace:team-a", rowName: "web", heldRing: true,
			object: func(rv string, deleting bool) interface{} {
				secret := helmRevision("team-a", "web", 1, release.StatusDeployed)
				secret.ResourceVersion = rv
				markDeleting(&secret.ObjectMeta, deleting)
				return secret
			},
		},
		{
			name: "Event (namespaced object)", gvr: eventGVR, domain: "namespace-events", scope: "namespace:team-a", rowName: "web.1", heldRing: true,
			ringWindow: time.Second,
			object: func(rv string, deleting bool) interface{} {
				return &corev1.Event{ObjectMeta: meta("web.1", "team-a", rv, deleting), Type: corev1.EventTypeNormal,
					InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "team-a", Name: "web"}}
			},
		},
		{
			name: "Event (cluster-scoped object)", gvr: eventGVR, domain: "cluster-events", scope: "", rowName: "node-a.1", heldRing: true,
			ringWindow: time.Second,
			object: func(rv string, deleting bool) interface{} {
				return &corev1.Event{ObjectMeta: meta("node-a.1", "default", rv, deleting), Type: corev1.EventTypeNormal,
					InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Node", Name: "node-a"}}
			},
		},
		{
			name: "Pod", gvr: podGVR, domain: "pods", scope: "namespace:team-a", rowName: "solo",
			object: func(rv string, deleting bool) interface{} {
				return &corev1.Pod{ObjectMeta: meta("solo", "team-a", rv, deleting), Spec: corev1.PodSpec{NodeName: "node-a"}}
			},
			derived: []struct{ domain, scope string }{{"namespace-workloads", "namespace:team-a"}, {"nodes", ""}},
		},
	}
}

// An ingest-fed table rings only after its store holds the change, for
// create, update, a finalizer-held deletion request, and a completed delete;
// and the read each ring triggers shows the change. Derived views (Identities
// for bindings; workload and node rows for pods) ring with it.
func TestIngestFedTableDoorbellFollowsItsStore(t *testing.T) {
	for _, tc := range ingestFedCases() {
		t.Run(tc.name, func(t *testing.T) {
			h := newIngestHarness(t)
			store := h.store(t, tc.gvr)
			sub := h.subscribe(t, tc.domain, tc.scope)
			derived := make([]*resourcestream.Subscription, 0, len(tc.derived))
			for _, d := range tc.derived {
				derived = append(derived, h.subscribe(t, d.domain, d.scope))
			}
			require.NotContains(t, h.rowNames(t, tc.domain, tc.scope), tc.rowName, "prime the cache")

			steps := []struct {
				name    string
				apply   func() error
				present bool
			}{
				{"create", func() error { return store.Add(tc.object("10", false)) }, true},
				{"update", func() error { return store.Update(tc.object("11", false)) }, true},
				{"deletion requested", func() error { return store.Update(tc.object("12", true)) }, true},
				{"delete", func() error { return store.Delete(tc.object("12", true)) }, false},
			}
			for _, step := range steps {
				hold := newWriteHold()
				t.Cleanup(hold.unblock)
				require.True(t, h.subsystem.IngestManager.AddCatalogSink(tc.gvr, hold))
				hold.armed.Store(true)
				done := make(chan error, 1)
				go func() { done <- step.apply() }()
				select {
				case <-hold.entered:
				case <-time.After(3 * time.Second):
					t.Fatalf("%s: the store write never reached its sinks", step.name)
				}
				if tc.heldRing {
					require.Equal(t, 0, collect(sub, 300*time.Millisecond), "%s: the doorbell rang before the store applied the change", step.name)
				}
				hold.unblock()
				require.NoError(t, <-done)
				ringWindow := tc.ringWindow
				if ringWindow == 0 {
					ringWindow = 300 * time.Millisecond
				}
				require.Positive(t, collect(sub, ringWindow), "%s: no doorbell", step.name)
				for i, d := range derived {
					require.Positive(t, collect(d, 200*time.Millisecond), "%s: no %s doorbell", step.name, tc.derived[i].domain)
				}
				for _, read := range []string{"doorbell refetch", "later cached read"} {
					names := h.rowNames(t, tc.domain, tc.scope)
					if step.present {
						require.Contains(t, names, tc.rowName, "%s: %s", step.name, read)
					} else {
						require.NotContains(t, names, tc.rowName, "%s: %s", step.name, read)
					}
				}
			}
		})
	}
}

func configMap(name, namespace, rv string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, UID: types.UID("uid-" + namespace + "-" + name)},
		Data:       map[string]string{"rv": rv},
	}
}

// A namespace partition's relist (scoped clusters relist one namespace at a
// time) rings each affected scope exactly once, after the store holds the
// partition's new set, never rings a sibling namespace, and keeps the sibling's
// rows. An unscoped relist rings each subscribed scope once.
func TestScopedRelistRingsEachAffectedScopeOnce(t *testing.T) {
	t.Run("namespace partition", func(t *testing.T) {
		h := newIngestHarness(t, "a", "b")
		store := h.store(t, configMapGVR)
		require.NoError(t, store.ReplacePartition("a", []interface{}{configMap("keep", "a", "1"), configMap("change", "a", "2"), configMap("drop", "a", "3")}, "10"))
		require.NoError(t, store.ReplacePartition("b", []interface{}{configMap("sibling", "b", "4")}, "11"))
		subA := h.subscribe(t, "namespace-config", "namespace:a")
		subB := h.subscribe(t, "namespace-config", "namespace:b")
		subAll := h.subscribe(t, "namespace-config", "namespace:all")

		require.NoError(t, store.PartitionView("a").Replace([]interface{}{
			configMap("keep", "a", "1"), configMap("change", "a", "5"), configMap("add", "a", "6"),
		}, "12"))

		require.Equal(t, 1, collect(subA, 500*time.Millisecond), "namespace:a")
		require.Equal(t, 1, collect(subAll, 100*time.Millisecond), "namespace:all")
		require.Equal(t, 0, collect(subB, 100*time.Millisecond), "a sibling namespace rang")
		require.Equal(t, []string{"add", "change", "keep"}, h.rowNames(t, "namespace-config", "namespace:a"))
		require.Equal(t, []string{"sibling"}, h.rowNames(t, "namespace-config", "namespace:b"))
		require.Equal(t, []string{"add", "change", "keep", "sibling"}, h.rowNames(t, "namespace-config", "namespace:all"))
	})
	t.Run("unscoped", func(t *testing.T) {
		h := newIngestHarness(t)
		store := h.store(t, configMapGVR)
		require.NoError(t, store.Replace([]interface{}{configMap("keep", "a", "1"), configMap("drop", "a", "2"), configMap("other", "b", "3")}, "10"))
		subA := h.subscribe(t, "namespace-config", "namespace:a")
		subB := h.subscribe(t, "namespace-config", "namespace:b")

		require.NoError(t, store.PartitionView("").Replace([]interface{}{
			configMap("keep", "a", "1"), configMap("add", "a", "4"), configMap("other", "b", "3"),
		}, "11"))

		require.Equal(t, 1, collect(subA, 500*time.Millisecond), "namespace:a")
		require.Equal(t, 1, collect(subB, 100*time.Millisecond), "namespace:b")
		require.Equal(t, []string{"add", "keep"}, h.rowNames(t, "namespace-config", "namespace:a"))
	})
}

// relistHold blocks a namespace relist at its first row, after the maintained
// store's sink has seen that row and before the relist ends, holding that
// source's batch open.
type relistHold struct {
	armed   atomic.Bool
	entered chan struct{}
	release chan struct{}
}

func (r *relistHold) UpsertBundle(ingest.Bundle) {
	if r.armed.CompareAndSwap(true, false) {
		r.entered <- struct{}{}
		<-r.release
	}
}
func (r *relistHold) DeleteBundle(ingest.Bundle) {}

func service(name, namespace, rv string) *corev1.Service {
	return &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, UID: types.UID("uid-" + name)}}
}

func endpointSlice(name, namespace, rv string) *discoveryv1.EndpointSlice {
	return &discoveryv1.EndpointSlice{
		ObjectMeta:  metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, UID: types.UID("uid-" + name)},
		AddressType: discoveryv1.AddressTypeIPv4,
	}
}

// Several sources feed one maintained store (four ingest kinds for the
// network table). Each source's relist batches its own rings: another source's
// relist ending while one is still open neither flushes nor clears it, and
// another source's update rings at once.
func TestOverlappingSourceRelistsKeepSeparateBatches(t *testing.T) {
	h := newIngestHarness(t, "a", "b")
	services := h.store(t, serviceGVR)
	slices := h.store(t, endpointSliceGVR)
	require.NoError(t, services.ReplacePartition("a", []interface{}{service("api", "a", "1")}, "10"))
	require.NoError(t, slices.ReplacePartition("b", []interface{}{endpointSlice("api-x1", "b", "2")}, "11"))
	hold := &relistHold{entered: make(chan struct{}, 1), release: make(chan struct{})}
	require.True(t, h.subsystem.IngestManager.AddBundleSink(serviceGVR, hold))
	t.Cleanup(func() {
		select {
		case <-hold.release:
		default:
			close(hold.release)
		}
	})
	subA := h.subscribe(t, "namespace-network", "namespace:a")
	subB := h.subscribe(t, "namespace-network", "namespace:b")
	subAll := h.subscribe(t, "namespace-network", "namespace:all")

	hold.armed.Store(true)
	done := make(chan error, 1)
	go func() {
		done <- services.PartitionView("a").Replace([]interface{}{service("api", "a", "3"), service("web", "a", "4")}, "12")
	}()
	select {
	case <-hold.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("the service relist never reached its sinks")
	}

	require.NoError(t, slices.PartitionView("b").Replace([]interface{}{endpointSlice("api-x1", "b", "5"), endpointSlice("api-x2", "b", "6")}, "13"))
	require.Equal(t, 1, collect(subB, 500*time.Millisecond), "namespace:b after the slice relist")
	require.Equal(t, 1, collect(subAll, 100*time.Millisecond), "namespace:all after the slice relist")
	require.Equal(t, 0, collect(subA, 100*time.Millisecond), "the open service relist rang early")

	require.NoError(t, slices.PartitionView("b").Update(endpointSlice("api-x2", "b", "7")))
	require.Positive(t, collect(subB, 300*time.Millisecond), "an update from another source must ring at once")
	collect(subAll, 100*time.Millisecond)

	close(hold.release)
	require.NoError(t, <-done)
	require.Equal(t, 1, collect(subA, 500*time.Millisecond), "namespace:a after the service relist")
	require.Equal(t, 1, collect(subAll, 100*time.Millisecond), "namespace:all after the service relist")
	require.Equal(t, []string{"api", "web"}, h.rowNames(t, "namespace-network", "namespace:a"))
	require.Equal(t, []string{"api-x1", "api-x2"}, h.rowNames(t, "namespace-network", "namespace:b"))
}

func ownedPod(rv string, owner *metav1.OwnerReference) *corev1.Pod {
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-1-abc", Namespace: "team-a", ResourceVersion: rv, UID: "pod-uid"}}
	if owner != nil {
		pod.OwnerReferences = []metav1.OwnerReference{*owner}
	}
	return pod
}

func replicaSetOwner(name string) *metav1.OwnerReference {
	controller := true
	return &metav1.OwnerReference{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: name, UID: types.UID("rs-" + name), Controller: &controller}
}

func workloadScope(kind, name string) string {
	return refresh.WorkloadSelector(refresh.ObjectScopeIdentity{
		Namespace: "team-a", GVK: appsv1.SchemeGroupVersion.WithKind(kind), Name: name,
	}).String()
}

// A pod whose owners change rings the scopes it left as well as the ones it
// entered, so the previous owner's Pods list drops it.
func TestPodOwnerChangeRingsPreviousOwnerScopes(t *testing.T) {
	h := newIngestHarness(t)
	replicaSets := h.store(t, replicaSetGVR)
	controller := true
	require.NoError(t, replicaSets.Add(&appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{
		Name: "web-1", Namespace: "team-a", UID: "rs-web-1",
		OwnerReferences: []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "Deployment", Name: "web", UID: "dep-web", Controller: &controller}},
	}}))
	require.NoError(t, replicaSets.Add(&appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{Name: "api-1", Namespace: "team-a", UID: "rs-api-1"}}))
	pods := h.store(t, podGVR)
	rsWeb := h.subscribe(t, "pods", workloadScope("ReplicaSet", "web-1"))
	deployment := h.subscribe(t, "pods", workloadScope("Deployment", "web"))
	rsAPI := h.subscribe(t, "pods", workloadScope("ReplicaSet", "api-1"))

	require.NoError(t, pods.Add(ownedPod("10", replicaSetOwner("web-1"))))
	require.Positive(t, collect(rsWeb, 300*time.Millisecond))
	require.Positive(t, collect(deployment, 100*time.Millisecond))
	require.Equal(t, []string{"web-1-abc"}, h.rowNames(t, "pods", workloadScope("Deployment", "web")))

	t.Run("owner replacement", func(t *testing.T) {
		require.NoError(t, pods.Update(ownedPod("11", replicaSetOwner("api-1"))))
		require.Positive(t, collect(rsWeb, 300*time.Millisecond), "the previous ReplicaSet's scope did not ring")
		require.Positive(t, collect(deployment, 100*time.Millisecond), "the previous Deployment's scope did not ring")
		require.Positive(t, collect(rsAPI, 100*time.Millisecond), "the new owner's scope did not ring")
		require.Empty(t, h.rowNames(t, "pods", workloadScope("Deployment", "web")))
		require.Equal(t, []string{"web-1-abc"}, h.rowNames(t, "pods", workloadScope("ReplicaSet", "api-1")))
	})
	t.Run("owner removal", func(t *testing.T) {
		require.NoError(t, pods.Update(ownedPod("12", nil)))
		require.Positive(t, collect(rsAPI, 300*time.Millisecond), "the previous owner's scope did not ring")
		require.Empty(t, h.rowNames(t, "pods", workloadScope("ReplicaSet", "api-1")))
	})
}

// A pod projected before its ReplicaSet was known keeps the ReplicaSet as its
// collapsed owner. When the ReplicaSet reflector delivers it, the heal rewrites
// the stored pod and the pods store rings the Deployment's Pods window.
func TestReplicaSetHealRingsHealedPodScopes(t *testing.T) {
	h := newIngestHarness(t)
	pods := h.store(t, podGVR)
	require.NoError(t, pods.Add(ownedPod("10", replicaSetOwner("web-1"))))
	require.Empty(t, h.rowNames(t, "pods", workloadScope("Deployment", "web")))
	deployment := h.subscribe(t, "pods", workloadScope("Deployment", "web"))

	controller := true
	require.NoError(t, h.store(t, replicaSetGVR).Add(&appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{
		Name: "web-1", Namespace: "team-a", UID: "rs-web-1", ResourceVersion: "20",
		OwnerReferences: []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "Deployment", Name: "web", UID: "dep-web", Controller: &controller}},
	}}))

	require.Positive(t, collect(deployment, 2*time.Second), "the healed pod's Deployment scope did not ring")
	require.Equal(t, []string{"web-1-abc"}, h.rowNames(t, "pods", workloadScope("Deployment", "web")))
}

// ServiceAccounts feed the RBAC table but not the Identities view, so their
// changes ring namespace-rbac without making Identities refetch.
func TestServiceAccountChangesDoNotRingIdentities(t *testing.T) {
	h := newIngestHarness(t)
	accounts := h.store(t, accountGVR)
	rbac := h.subscribe(t, "namespace-rbac", "namespace:team-a")
	identities := h.subscribe(t, "cluster-identities", "")
	account := &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "team-a", ResourceVersion: "1", UID: "sa-1"}}

	require.NoError(t, accounts.Add(account))
	require.NoError(t, accounts.Delete(account))

	require.Equal(t, 2, collect(rbac, 300*time.Millisecond))
	require.Equal(t, 0, collect(identities, 100*time.Millisecond))
}

// A whole-kind relist rings only subscribed views, but it must still drop the
// domain's cached pages: a user who left the table and returns before the
// cache expires must not reload the pre-relist rows.
func TestUnsubscribedRelistDoesNotServeStaleCachedRows(t *testing.T) {
	h := newIngestHarness(t)
	store := h.store(t, configMapGVR)
	require.NoError(t, store.Replace([]interface{}{configMap("keep", "a", "1"), configMap("drop", "a", "2")}, "10"))
	require.Equal(t, []string{"drop", "keep"}, h.rowNames(t, "namespace-config", "namespace:a"), "prime the cache")

	require.NoError(t, store.PartitionView("").Replace([]interface{}{configMap("keep", "a", "1"), configMap("add", "a", "3")}, "11"))

	require.Equal(t, []string{"add", "keep"}, h.rowNames(t, "namespace-config", "namespace:a"))
}

// Without pod access the Nodes table falls back to listing nodes from the API
// server. Its rows still change only through node changes, so the node ingest
// store must ring it; a healthy stream does not poll.
func TestNodesListFallbackRingsOnNodeChanges(t *testing.T) {
	h := newIngestHarnessDenying(t, []string{"pods"})
	nodes := h.store(t, nodeGVR)
	sub := h.subscribe(t, "nodes", "")
	require.Empty(t, h.rowNames(t, "nodes", ""), "prime the cache")

	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-1", UID: "node-1", ResourceVersion: "1"}}
	created, err := h.kube.CoreV1().Nodes().Create(t.Context(), node, metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, nodes.Add(created))
	require.Positive(t, collect(sub, 300*time.Millisecond), "create: no doorbell")
	require.Equal(t, []string{"worker-1"}, h.rowNames(t, "nodes", ""))

	require.NoError(t, h.kube.CoreV1().Nodes().Delete(t.Context(), "worker-1", metav1.DeleteOptions{}))
	require.NoError(t, nodes.Delete(created))
	require.Positive(t, collect(sub, 300*time.Millisecond), "delete: no doorbell")
	require.Empty(t, h.rowNames(t, "nodes", ""))

	require.NoError(t, nodes.Replace([]interface{}{
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-2", UID: "node-2", ResourceVersion: "3"}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-3", UID: "node-3", ResourceVersion: "4"}},
	}, "5"))
	require.Equal(t, 1, collect(sub, 300*time.Millisecond), "a relist rings once")
}
