package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
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

func newTestInformerFactory() *informer.Factory {
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
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
	started chan struct{}
}

func (m *recordingHubManager) Start(context.Context) { close(m.started) }

func (m *recordingHubManager) Stop() {}

func (m *recordingHubManager) StoreFor(schema.GroupVersionResource) *ingest.ProjectingStore {
	return nil
}

func (m *recordingHubManager) HasSyncedFor(schema.GroupVersionResource) bool { return false }
