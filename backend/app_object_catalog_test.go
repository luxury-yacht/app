package backend

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
	"unsafe"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	informers "k8s.io/client-go/informers"
	cgofake "k8s.io/client-go/kubernetes/fake"
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
