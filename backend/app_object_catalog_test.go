package backend

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
	"unsafe"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic/fake"
	informers "k8s.io/client-go/informers"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

func TestStopObjectCatalogCancelsAndResets(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)

	cancelCalled := 0
	done := make(chan struct{}, 1)
	done <- struct{}{}
	app.storeObjectCatalogEntry("cluster-a", &objectCatalogEntry{
		service: &objectcatalog.Service{},
		cancel:  func() { cancelCalled++ },
		done:    done,
	})
	app.telemetryRecorder = telemetry.NewRecorder()

	app.stopObjectCatalog()

	if cancelCalled != 1 {
		t.Fatalf("expected cancel to be invoked once, got %d", cancelCalled)
	}
	if app.objectCatalogServiceForCluster("cluster-a") != nil {
		t.Fatalf("expected catalog references to be cleared")
	}

	summary := app.telemetryRecorder.SnapshotSummary()
	if summary.Catalog != nil && summary.Catalog.Enabled {
		t.Fatalf("expected catalog telemetry to be disabled")
	}
}

func TestStopObjectCatalogDoesNotBlockForeverWaitingForDone(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)

	cancelCalled := make(chan struct{})
	app.storeObjectCatalogEntry("cluster-a", &objectCatalogEntry{
		service: &objectcatalog.Service{},
		cancel:  func() { close(cancelCalled) },
		done:    make(chan struct{}),
	})

	returned := make(chan struct{})
	go func() {
		app.stopObjectCatalog()
		close(returned)
	}()

	select {
	case <-cancelCalled:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected catalog stop to cancel the running catalog")
	}

	select {
	case <-returned:
	case <-time.After(config.RefreshShutdownTimeout + 500*time.Millisecond):
		t.Fatal("stopObjectCatalog blocked waiting for catalog done")
	}
}

func TestCatalogDoorbellBridgeBroadcastsCatalogSource(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"},
		nil,
		nil,
	)
	selector, err := resourcestream.ParseStreamSelector("cluster-a", "catalog", "")
	require.NoError(t, err)
	sub, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	updates := make(chan objectcatalog.StreamingUpdate, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runCatalogDoorbellBridge(ctx, updates, manager)
	}()

	updates <- objectcatalog.StreamingUpdate{Ready: true}

	select {
	case update := <-sub.Updates:
		require.Equal(t, "catalog", update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, resourcestream.SourceCatalog, update.Source)
		require.Equal(t, resourcestream.SignalChanged, update.Signal)
		require.Equal(t, "1", update.Version)
		require.Equal(t, "cluster-a", update.ClusterID)
	case <-time.After(time.Second):
		t.Fatal("expected catalog doorbell update")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("catalog doorbell bridge did not stop")
	}
}

func TestGetCatalogDiagnosticsCombinesTelemetryAndServiceState(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.storeObjectCatalogEntry("cluster-a", &objectCatalogEntry{
		service: &objectcatalog.Service{},
	})
	app.telemetryRecorder = telemetry.NewRecorder()

	app.telemetryRecorder.RecordCatalog(true, 7, 3, 1500*time.Millisecond, nil)

	diag, err := app.GetCatalogDiagnostics()
	if err != nil {
		t.Fatalf("GetCatalogDiagnostics returned error: %v", err)
	}
	if !diag.Enabled {
		t.Fatalf("expected diagnostics to report enabled catalog")
	}
	if diag.ItemCount != 7 || diag.ResourceCount != 3 {
		t.Fatalf("unexpected counts: %#v", diag)
	}
	if diag.LastSyncMs == 0 || diag.LastSuccessMs == 0 {
		t.Fatalf("expected sync timings to be populated")
	}
	if diag.Status != "success" {
		t.Fatalf("expected status success, got %s", diag.Status)
	}
}

func TestSnapshotObjectCatalogEntriesSortsByClusterID(t *testing.T) {
	app := NewApp()
	entryA := &objectCatalogEntry{meta: ClusterMeta{ID: "cluster-a"}}
	entryB := &objectCatalogEntry{meta: ClusterMeta{ID: "cluster-b"}}

	app.objectCatalogEntries = map[string]*objectCatalogEntry{
		"b":   entryB,
		"a":   entryA,
		"nil": nil,
	}

	entries := app.snapshotObjectCatalogEntries()
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0] != entryA || entries[1] != entryB {
		t.Fatalf("expected sorted entries, got %#v", entries)
	}
	if entries[2] != nil {
		t.Fatalf("expected nil entry at the end")
	}
}

func TestCatalogNamespaceGroupsFiltersAndMapsNamespaces(t *testing.T) {
	app := NewApp()

	withNamespaces := objectcatalog.NewService(objectcatalog.Dependencies{}, nil)
	setCatalogServiceNamespaces(t, withNamespaces, []string{"default", "kube-system"})

	app.objectCatalogEntries = map[string]*objectCatalogEntry{
		"cluster-a": {
			service: withNamespaces,
			meta: ClusterMeta{
				ID:   "cluster-a",
				Name: "Cluster A",
			},
		},
		"cluster-b": {
			service: objectcatalog.NewService(objectcatalog.Dependencies{}, nil),
			meta: ClusterMeta{
				ID:   "cluster-b",
				Name: "Cluster B",
			},
		},
		"cluster-c": {
			service: withNamespaces,
			meta: ClusterMeta{
				ID:   "",
				Name: "Cluster C",
			},
		},
		"cluster-d": nil,
	}

	groups := app.catalogNamespaceGroups()
	if len(groups) != 1 {
		t.Fatalf("expected 1 namespace group, got %d", len(groups))
	}
	group := groups[0]
	if group.ClusterID != "cluster-a" || group.ClusterName != "Cluster A" {
		t.Fatalf("unexpected cluster metadata: %#v", group)
	}
	if len(group.Namespaces) != 2 {
		t.Fatalf("expected namespace list, got %#v", group.Namespaces)
	}
}

func setCatalogServiceNamespaces(t *testing.T, svc *objectcatalog.Service, namespaces []string) {
	t.Helper()
	// Use reflection to set cached namespaces without running the catalog service.
	value := reflect.ValueOf(svc).Elem().FieldByName("cachedNamespaces")
	if !value.IsValid() {
		t.Fatalf("cachedNamespaces field not found")
	}
	copyNamespaces := append([]string(nil), namespaces...)
	reflect.NewAt(value.Type(), unsafe.Pointer(value.UnsafeAddr())).Elem().Set(reflect.ValueOf(copyNamespaces))
}

func TestGetCatalogDiagnosticsFromTelemetryRecorder(t *testing.T) {
	recorder := telemetry.NewRecorder()
	recorder.RecordCatalog(true, 5, 2, 1500*time.Millisecond, errors.New("collect failed"))
	recorder.RecordSnapshot("pods", "default", "test-cluster", "test", 50*time.Millisecond, nil, false, 3, nil, 1, 0, 0, true, 25)

	app := &App{telemetryRecorder: recorder}

	diag, err := app.GetCatalogDiagnostics()
	require.NoError(t, err)

	require.True(t, diag.Enabled)
	require.Equal(t, 5, diag.ItemCount)
	require.Equal(t, 2, diag.ResourceCount)
	require.Equal(t, "collect failed", diag.LastError)
	require.Len(t, diag.Domains, 1)
	require.Equal(t, "pods", diag.Domains[0].Domain)
}

func TestFindCatalogObjectMatchUsesExactCatalogIdentity(t *testing.T) {
	app := NewApp()
	svc := objectcatalog.NewService(objectcatalog.Dependencies{}, nil)
	setCatalogServiceItems(t, svc, map[string]objectcatalog.Summary{
		"apps/v1, Resource=deployments/apps/alpha": {
			ClusterID: "cluster-b",
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "apps",
			Name:      "alpha",
			UID:       "alpha-uid",
			Scope:     objectcatalog.ScopeNamespace,
		},
		"apps/v1, Resource=deployments/apps/alpha-canary": {
			ClusterID: "cluster-b",
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "apps",
			Name:      "alpha-canary",
			UID:       "alpha-canary-uid",
			Scope:     objectcatalog.ScopeNamespace,
		},
	})
	app.storeObjectCatalogEntry("cluster-b", &objectCatalogEntry{service: svc})

	match, err := app.FindCatalogObjectMatch("cluster-b", "apps", "apps", "v1", "Deployment", "alpha")
	require.NoError(t, err)
	require.NotNil(t, match)
	require.Equal(t, "alpha-uid", match.UID)

	noMatch, err := app.FindCatalogObjectMatch("cluster-b", "apps", "apps", "v1", "Deployment", "alp")
	require.NoError(t, err)
	require.Nil(t, noMatch)
}

func TestFindCatalogObjectByUIDUsesCatalogIdentity(t *testing.T) {
	app := NewApp()
	svc := objectcatalog.NewService(objectcatalog.Dependencies{}, nil)
	setCatalogServiceItems(t, svc, map[string]objectcatalog.Summary{
		"apps/v1, Resource=deployments/apps/alpha": {
			ClusterID: "cluster-b",
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "apps",
			Name:      "alpha",
			UID:       "alpha-uid",
			Scope:     objectcatalog.ScopeNamespace,
		},
	})
	app.storeObjectCatalogEntry("cluster-b", &objectCatalogEntry{service: svc})

	match, err := app.FindCatalogObjectByUID("cluster-b", "alpha-uid")
	require.NoError(t, err)
	require.NotNil(t, match)
	require.Equal(t, "Deployment", match.Kind)
	require.Equal(t, "apps", match.Namespace)

	noMatch, err := app.FindCatalogObjectByUID("cluster-b", "missing-uid")
	require.NoError(t, err)
	require.Nil(t, noMatch)
}

func TestHydrateCatalogCustomRowsFetchesOnlyCurrentPageRows(t *testing.T) {
	clusterID := "cluster-b"
	gvrObject := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "example.com/v1",
			"kind":       "Widget",
			"status": map[string]any{
				"phase":              "Ready",
				"ready":              true,
				"observedGeneration": int64(7),
				"conditions": []any{
					map[string]any{
						"type":    "Ready",
						"status":  "True",
						"reason":  "Reconciled",
						"message": "ready",
					},
				},
			},
		},
	}
	gvrObject.SetName("alpha")
	gvrObject.SetNamespace("apps")
	gvrObject.SetUID(types.UID("alpha-uid"))
	gvrObject.SetResourceVersion("12")
	gvrObject.SetCreationTimestamp(metav1.Now())
	gvrObject.SetLabels(map[string]string{"env": "prod"})
	gvrObject.SetAnnotations(map[string]string{"owner": "platform"})

	app := NewApp()
	app.clusterClients[clusterID] = &clusterClients{
		meta:          ClusterMeta{ID: clusterID, Name: "Cluster B"},
		dynamicClient: fake.NewSimpleDynamicClient(runtime.NewScheme(), gvrObject),
	}

	rows, err := app.HydrateCatalogCustomRows(clusterID, []snapshot.ResourceQueryRow{
		{
			ClusterID: clusterID,
			Group:     "example.com",
			Version:   "v1",
			Kind:      "Widget",
			Resource:  "widgets",
			Namespace: "apps",
			Name:      "alpha",
			UID:       "alpha-uid",
		},
	})

	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, clusterID, rows[0].ClusterID)
	require.Equal(t, "Cluster B", rows[0].ClusterName)
	require.Equal(t, "Widget", rows[0].Kind)
	require.Equal(t, "apps", rows[0].Namespace)
	require.Equal(t, "example.com", rows[0].Group)
	require.Equal(t, "v1", rows[0].Version)
	require.Equal(t, "widgets.example.com", rows[0].CRDName)
	require.Equal(t, "Ready", rows[0].Status)
	require.Equal(t, "ready", rows[0].StatusPresentation)
	require.Equal(t, map[string]string{"env": "prod"}, rows[0].Labels)
	require.Equal(t, map[string]string{"owner": "platform"}, rows[0].Annotations)
	require.NotNil(t, rows[0].Ready)
	require.True(t, *rows[0].Ready)
	require.NotNil(t, rows[0].ObservedGeneration)
	require.EqualValues(t, 7, *rows[0].ObservedGeneration)
	require.Len(t, rows[0].Conditions, 1)
	require.Equal(t, "Ready", rows[0].Conditions[0].Type)
}

// A canceled context must surface as an error, never as a silently partial
// (or empty) "complete" result.
func TestHydrateCatalogCustomRowsReportsCanceledContext(t *testing.T) {
	clusterID := "cluster-b"
	app := NewApp()
	app.clusterClients[clusterID] = &clusterClients{
		meta:          ClusterMeta{ID: clusterID, Name: "Cluster B"},
		dynamicClient: fake.NewSimpleDynamicClient(runtime.NewScheme()),
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	app.Ctx = canceled

	_, err := app.HydrateCatalogCustomRows(clusterID, []snapshot.ResourceQueryRow{
		{
			ClusterID: clusterID,
			Group:     "example.com",
			Version:   "v1",
			Kind:      "Widget",
			Resource:  "widgets",
			Namespace: "apps",
			Name:      "alpha",
			UID:       "alpha-uid",
		},
	})

	require.ErrorIs(t, err, context.Canceled)
}

func TestHydrateCatalogCustomRowsKeepsPageOnRowFailure(t *testing.T) {
	clusterID := "cluster-b"
	gvrObject := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "example.com/v1",
			"kind":       "Widget",
			"status": map[string]any{
				"phase": "Ready",
			},
		},
	}
	gvrObject.SetName("alpha")
	gvrObject.SetNamespace("apps")

	dynamicClient := fake.NewSimpleDynamicClient(runtime.NewScheme(), gvrObject)
	dynamicClient.PrependReactor("get", "widgets", func(action cgotesting.Action) (bool, runtime.Object, error) {
		getAction, ok := action.(cgotesting.GetAction)
		if !ok || getAction.GetName() != "beta" {
			return false, nil, nil
		}
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "example.com", Resource: "widgets"},
			"beta",
			errors.New("forbidden"),
		)
	})

	app := NewApp()
	app.Ctx = context.Background()
	app.clusterClients[clusterID] = &clusterClients{
		meta:          ClusterMeta{ID: clusterID, Name: "Cluster B"},
		dynamicClient: dynamicClient,
	}

	rows, err := app.HydrateCatalogCustomRows(clusterID, []snapshot.ResourceQueryRow{
		{
			ClusterID: clusterID,
			Group:     "example.com",
			Version:   "v1",
			Kind:      "Widget",
			Resource:  "widgets",
			Namespace: "apps",
			Name:      "alpha",
		},
		{
			ClusterID: clusterID,
			Group:     "example.com",
			Version:   "v1",
			Kind:      "Widget",
			Resource:  "widgets",
			Namespace: "apps",
			Name:      "beta",
		},
	})

	require.NoError(t, err)
	require.Len(t, rows, 2)

	byName := make(map[string]snapshot.CustomResourceSummary, len(rows))
	for _, row := range rows {
		byName[row.Name] = row
	}
	require.Equal(t, "Ready", byName["alpha"].Status)
	require.Equal(t, "Hydration failed", byName["beta"].Status)
	require.Equal(t, "warning", byName["beta"].StatusState)
	require.Equal(t, "warning", byName["beta"].StatusPresentation)
	require.Equal(t, "widgets.example.com", byName["beta"].CRDName)
}

func TestWaitForFactorySyncHandlesNilFactory(t *testing.T) {
	if !waitForFactorySync(context.Background(), nil) {
		t.Fatal("nil factory should return true")
	}
	if !waitForAPIExtensionsFactorySync(context.Background(), nil) {
		t.Fatal("nil apiextensions factory should return true")
	}
}

func TestWaitForFactoriesRespectContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	factory := informers.NewSharedInformerFactory(cgofake.NewClientset(), 0)
	// ensure at least one informer is registered
	factory.Core().V1().Pods()

	if waitForFactorySync(ctx, factory) {
		t.Fatal("expected factory sync to stop when context is canceled")
	}

	apiExtFactory := apiextinformers.NewSharedInformerFactory(apiextensionsfake.NewClientset(), 0)
	apiExtFactory.Apiextensions().V1().CustomResourceDefinitions()

	if waitForAPIExtensionsFactorySync(ctx, apiExtFactory) {
		t.Fatal("expected apiextensions factory sync to stop when context is canceled")
	}
}

func setCatalogServiceItems(
	t *testing.T,
	svc *objectcatalog.Service,
	items map[string]objectcatalog.Summary,
) {
	t.Helper()

	value := reflect.ValueOf(svc).Elem().FieldByName("items")
	if !value.IsValid() {
		t.Fatalf("items field not found")
	}

	copyItems := make(map[string]objectcatalog.Summary, len(items))
	for key, item := range items {
		copyItems[key] = item
	}
	reflect.NewAt(value.Type(), unsafe.Pointer(value.UnsafeAddr())).Elem().Set(reflect.ValueOf(copyItems))
}
