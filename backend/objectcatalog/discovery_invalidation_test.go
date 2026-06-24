package objectcatalog

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/tools/cache"
)

// stubDiscovery is a minimal DiscoveryInterface returning a fixed resource list, so the
// catalog's discover path can be exercised without a real apiserver. Only the methods the
// discover path calls are implemented; the rest are nil (never invoked here).
type stubDiscovery struct {
	discovery.DiscoveryInterface
	lists []*metav1.APIResourceList
}

func (s *stubDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return s.lists, nil
}

func podOnlyResourceLists() []*metav1.APIResourceList {
	return []*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod", Namespaced: true, Verbs: []string{"list"}}},
	}}
}

// TestCatalogDiscoveryInvalidatesAfterCRDChange pins the disk-cache invalidation contract:
// a periodic discover serves from the cache (no Invalidate), but once a CRD change has
// marked discovery stale the next discover Invalidate()s the cache exactly once, so a
// newly-created CRD is never hidden behind a stale discovery document.
func TestCatalogDiscoveryInvalidatesAfterCRDChange(t *testing.T) {
	invalidations := 0
	svc := &Service{clusterID: "c1"}
	svc.discoveryClient = &stubDiscovery{lists: podOnlyResourceLists()}
	svc.discoveryInvalidate = func() { invalidations++ }

	ctx := context.Background()

	// Periodic discover, no CRD change → no invalidation (the cache is reused).
	descs, err := svc.discoverResources(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, descs)
	require.Equal(t, 0, invalidations)

	// A CRD change marks discovery stale → the next discover invalidates once.
	svc.markDiscoveryStale()
	_, err = svc.discoverResources(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, invalidations)

	// No further CRD change → no extra invalidation.
	_, err = svc.discoverResources(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, invalidations)

	// Another CRD change → invalidates again.
	svc.markDiscoveryStale()
	_, err = svc.discoverResources(ctx)
	require.NoError(t, err)
	require.Equal(t, 2, invalidations)
}

// TestCRDWatchHandlerMarksDiscoveryStale proves the wiring: a CRD add/update/delete event
// on the apiext informer marks discovery stale (so the next discover invalidates) and still
// delegates to the base handler.
func TestCRDWatchHandlerMarksDiscoveryStale(t *testing.T) {
	svc := &Service{clusterID: "c1"}
	baseCalls := 0
	base := cache.ResourceEventHandlerFuncs{
		AddFunc:    func(interface{}) { baseCalls++ },
		UpdateFunc: func(interface{}, interface{}) { baseCalls++ },
		DeleteFunc: func(interface{}) { baseCalls++ },
	}
	h := svc.crdWatchHandler(base)

	require.False(t, svc.discoveryStale.Load())
	h.AddFunc(nil)
	require.True(t, svc.discoveryStale.Load(), "a CRD add marks discovery stale")
	require.Equal(t, 1, baseCalls, "the base handler still runs")

	svc.discoveryStale.Store(false)
	h.DeleteFunc(nil)
	require.True(t, svc.discoveryStale.Load(), "a CRD delete marks discovery stale")
	require.Equal(t, 2, baseCalls)
}
