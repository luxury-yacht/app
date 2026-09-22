package objectcatalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	kubefake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

// Real HTTP cancellation and real ingest/catalog owners exercise a pending watch,
// successful LIST fallback, partial publication on timeout, and recovery.
func TestPendingDynamicSourceAllowsCatalogCollectionAndRecovery(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	release := make(chan struct{})
	var stall atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("watch") == "true" {
			<-r.Context().Done()
			return
		}
		widget := strings.HasSuffix(r.URL.Path, "/widgets")
		if widget && r.UserAgent() == "ingest-readiness-test" {
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		if widget && stall.Load() {
			<-r.Context().Done()
			return
		}
		kind, name := "Gadget", "ready-kind"
		if widget {
			kind, name = "Widget", "pending-kind"
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"apiVersion": "example.com/v1", "kind": kind + "List", "metadata": map[string]string{"resourceVersion": "1"},
			"items": []interface{}{map[string]interface{}{"apiVersion": "example.com/v1", "kind": kind, "metadata": map[string]string{"namespace": "default", "name": name, "uid": name, "resourceVersion": "1"}}},
		})
	}))
	defer server.Close()
	watched, err := dynamic.NewForConfig(&rest.Config{Host: server.URL, UserAgent: "ingest-readiness-test"})
	require.NoError(t, err)
	listed, err := dynamic.NewForConfig(&rest.Config{Host: server.URL, UserAgent: "catalog-readiness-test"})
	require.NoError(t, err)
	mgr := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "c1"}, kubefake.NewClientset(), nil, nil)
	mgr.SetDynamicClient(watched)
	mgr.SetPermissionFilter(func(group, _, _ string) bool { return group == "example.com" })
	mgr.Start(t.Context())
	defer mgr.Stop()
	desc := widgetDesc()
	require.True(t, mgr.RegisterDynamicCatalogReflector(desc.GVR(), desc.GVR().GroupVersion().WithKind(desc.Kind), func(obj metav1.Object) interface{} { return summaryFromObject("c1", desc, obj) }, true))
	require.True(t, mgr.HasSynced(), "a pending dynamic source must not block the global/metrics readiness gate")
	require.False(t, mgr.HasSyncedFor(desc.GVR()))
	svc := NewService(Dependencies{Common: common.Dependencies{DynamicClient: listed}, IngestSource: mgr, ClusterID: "c1"}, nil)
	svc.discoveryClient = &stubDiscovery{lists: []*metav1.APIResourceList{{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{
		{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list", "watch"}},
		{Name: "gadgets", Kind: "Gadget", Namespaced: true, Verbs: []string{"list"}},
	}}}}
	require.NoError(t, svc.sync(t.Context()))
	require.Equal(t, 2, svc.Query(QueryOptions{}).TotalItems, "first collection must include an allowed kind before its watch baseline arrives")
	stall.Store(true)
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	require.Error(t, svc.sync(ctx))
	require.Equal(t, 2, svc.Query(QueryOptions{}).TotalItems, "a timed-out kind retains its prior row while other kinds remain queryable")
	require.NotEqual(t, HealthStateOK, svc.Health().Status)
	stall.Store(false)
	close(release)
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(desc.GVR()) }, time.Second, time.Millisecond)
	require.NoError(t, svc.sync(t.Context()))
	require.Equal(t, HealthStateOK, svc.Health().Status)
	require.Equal(t, 2, svc.Query(QueryOptions{}).TotalItems, "the watch baseline must not duplicate the LIST fallback")
}
