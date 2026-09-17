package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

func TestIngestInformerHubStartsIngestBeforeFactorySyncCompletes(t *testing.T) {
	factory := &blockingHubFactory{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	manager := &recordingHubManager{started: make(chan struct{})}
	hub := newIngestInformerHub(factory, manager)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- hub.Start(ctx)
	}()

	require.Eventually(t, func() bool {
		select {
		case <-factory.started:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	select {
	case <-manager.started:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("ingest manager did not start while factory Start was still blocked")
	}

	close(factory.release)
	require.NoError(t, <-done)
}

func TestIngestInformerHubStartReturnsAfterFactoryReady(t *testing.T) {
	factory := newTestInformerFactory()
	manager := newUnreachableIngestManager(t)
	require.False(t, manager.HasSynced())

	hub := newIngestInformerHub(factory, manager)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	require.NoError(t, hub.Start(ctx))
	require.False(t, manager.HasSynced())
	require.NoError(t, hub.Shutdown())
}

func TestIngestInformerHubGlobalReadinessTracksFactoryOnly(t *testing.T) {
	factory := newTestInformerFactory()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	require.NoError(t, factory.Start(ctx))
	require.True(t, factory.HasSynced(context.Background()))

	manager := newUnreachableIngestManager(t)
	require.False(t, manager.HasSynced())
	hub := newIngestInformerHub(factory, manager)

	require.True(t, hub.HasSynced(context.Background()))
	require.False(t, hub.ResourcesSettled([]string{permissions.ResourceKey("", "configmaps")}))
	require.True(t, hub.ResourcesSettled([]string{permissions.ResourceKey("", "namespaces")}))
	require.NoError(t, hub.Shutdown())
}

func TestIngestInformerHubRoutesPerResourceDataReadiness(t *testing.T) {
	const configMapsKey = "core/configmaps"
	const namespacesKey = "core/namespaces"
	manager := &recordingHubManager{
		started:   make(chan struct{}),
		readiness: refresh.ResourceReadinessDegraded,
	}
	factory := &reportingHubFactory{readiness: map[string]refresh.ResourceReadiness{
		namespacesKey: refresh.ResourceReadinessReady,
	}}
	hub := newIngestInformerHub(factory, manager)

	got := hub.ResourceReadiness([]string{configMapsKey, namespacesKey})
	require.Equal(t, refresh.ResourceReadinessDegraded, got[configMapsKey])
	require.Equal(t, refresh.ResourceReadinessReady, got[namespacesKey])

	hubWithoutIngest := newIngestInformerHub(factory, nil)
	require.Equal(t, refresh.ResourceReadinessUnavailable, hubWithoutIngest.ResourceReadiness([]string{configMapsKey})[configMapsKey])
	require.Equal(t, refresh.ResourceReadinessUnknown, hub.ResourceReadiness([]string{"unknown.example.com/unknowns"})["unknown.example.com/unknowns"])
}

func TestIngestInformerHubRoutesSettlementAndReadinessByResourceIdentity(t *testing.T) {
	configMaps := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	deployments := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	manager := &recordingHubManager{
		stores: map[schema.GroupVersionResource]*ingest.ProjectingStore{
			configMaps: {}, deployments: {},
		},
		synced: map[schema.GroupVersionResource]bool{configMaps: true},
		readinessByGVR: map[schema.GroupVersionResource]refresh.ResourceReadiness{
			configMaps:  refresh.ResourceReadinessReady,
			deployments: refresh.ResourceReadinessPending,
		},
	}
	factory := &reportingHubFactory{
		settled:   map[string]bool{"core/namespaces": false},
		readiness: map[string]refresh.ResourceReadiness{"core/namespaces": refresh.ResourceReadinessDegraded},
	}
	hub := newIngestInformerHub(factory, manager)
	for _, tc := range []struct {
		name    string
		keys    []string
		settled bool
	}{
		{name: "empty request", settled: true},
		{name: "synced ingest resource", keys: []string{"core/configmaps"}, settled: true},
		{name: "warming ingest resource", keys: []string{"core/configmaps", "apps/deployments"}},
		{name: "skipped ingest resource", keys: []string{"core/secrets"}, settled: true},
		{name: "mixed factory resource", keys: []string{"core/configmaps", "core/namespaces"}},
		{name: "unknown resource", keys: []string{"example.com/widgets"}, settled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.settled, hub.ResourcesSettled(tc.keys))
		})
	}
	require.Equal(t, map[string]refresh.ResourceReadiness{
		"core/configmaps":  refresh.ResourceReadinessReady,
		"apps/deployments": refresh.ResourceReadinessPending,
		"core/namespaces":  refresh.ResourceReadinessDegraded,
	}, hub.ResourceReadiness([]string{"core/configmaps", "apps/deployments", "core/namespaces"}))
}

func newTestInformerFactory() *informer.Factory {
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		return true, nil
	})
	return informer.New(kubernetesfake.NewClientset(), nil, time.Hour, checker)
}

func newUnreachableIngestManager(t *testing.T) *ingest.IngestManager {
	t.Helper()
	kube, err := kubernetes.NewForConfig(&rest.Config{Host: "http://127.0.0.1:1"})
	require.NoError(t, err)
	return ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "cluster-a", ClusterName: "cluster-a"}, kube, nil, nil)
}

type blockingHubFactory struct {
	started chan struct{}
	release chan struct{}
}

type reportingHubFactory struct {
	readiness map[string]refresh.ResourceReadiness
	settled   map[string]bool
}

func (f *reportingHubFactory) Start(context.Context) error    { return nil }
func (f *reportingHubFactory) HasSynced(context.Context) bool { return true }
func (f *reportingHubFactory) ResourcesSettled(keys []string) bool {
	for _, key := range keys {
		if settled, known := f.settled[key]; known && !settled {
			return false
		}
	}
	return true
}
func (f *reportingHubFactory) Shutdown() error { return nil }
func (f *reportingHubFactory) ResourceReadiness(keys []string) map[string]refresh.ResourceReadiness {
	result := make(map[string]refresh.ResourceReadiness, len(keys))
	for _, key := range keys {
		result[key] = f.readiness[key]
	}
	return result
}

func (f *blockingHubFactory) Start(ctx context.Context) error {
	close(f.started)
	select {
	case <-f.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (f *blockingHubFactory) HasSynced(context.Context) bool { return false }

func (f *blockingHubFactory) ResourcesSettled([]string) bool { return false }

func (f *blockingHubFactory) Shutdown() error { return nil }

type recordingHubManager struct {
	started        chan struct{}
	readiness      refresh.ResourceReadiness
	stores         map[schema.GroupVersionResource]*ingest.ProjectingStore
	synced         map[schema.GroupVersionResource]bool
	readinessByGVR map[schema.GroupVersionResource]refresh.ResourceReadiness
}

func (m *recordingHubManager) Start(context.Context) { close(m.started) }

func (m *recordingHubManager) Stop() {}

func (m *recordingHubManager) StoreFor(gvr schema.GroupVersionResource) *ingest.ProjectingStore {
	return m.stores[gvr]
}

func (m *recordingHubManager) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	return m.synced[gvr]
}

func (m *recordingHubManager) ResourceReadinessFor(gvr schema.GroupVersionResource) refresh.ResourceReadiness {
	if readiness, ok := m.readinessByGVR[gvr]; ok {
		return readiness
	}
	return m.readiness
}
