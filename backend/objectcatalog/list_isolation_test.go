package objectcatalog

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

// A large collection may take longer than one request budget without any page
// being slow. Each page and namespace must still complete and allow promotion.
func TestCatalogListBudgetRenewsForEveryPageAndNamespace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(100 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		page := r.URL.Query().Get("continue")
		next := ""
		if page == "" {
			page = "first"
			next = "second"
		}
		namespace := "a"
		if strings.Contains(r.URL.Path, "/namespaces/b/") {
			namespace = "b"
		}
		writeCatalogListPage(w, "Widget", namespace, page, next)
	}))
	defer server.Close()
	client, err := dynamic.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	source := newFakeDynamicIngestSource()
	svc := NewService(Dependencies{ClusterID: "c1", Common: common.Dependencies{DynamicClient: client}, IngestSource: source}, &Options{ListRequestTimeout: 250 * time.Millisecond, NamespaceWorkers: 1, InformerPromotionThreshold: 3})
	rows, err := svc.collectResource(t.Context(), widgetDesc(), []string{"a", "b"}, nil)
	require.NoError(t, err, "four healthy pages must not share one 250 ms collection deadline")
	require.Len(t, rows, 4)
	require.True(t, source.registered(widgetDesc().GVR()), "a large non-CRD collection must reach promotion")
}

func TestCatalogListRetryGetsANewRequestBudget(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(100 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		if requests.Add(1) == 1 {
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		writeCatalogListPage(w, "Widget", "default", "recovered", "")
	}))
	defer server.Close()
	client, err := dynamic.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	svc := NewService(Dependencies{ClusterID: "c1", Common: common.Dependencies{DynamicClient: client}}, &Options{ListRequestTimeout: 150 * time.Millisecond})
	rows, err := svc.collectResource(t.Context(), widgetDesc(), []string{"default"}, nil)
	require.NoError(t, err, "retry backoff and the previous attempt must not consume the next request's budget")
	require.Len(t, rows, 1)
	require.Equal(t, "recovered", rows[0].Ref.Name)
	require.Equal(t, int32(2), requests.Load())
}

// One hung kind must retain its old rows while an independent successful kind
// publishes fresh rows. Both requests run through real HTTP cancellation.
func TestCatalogListTimeoutDoesNotCancelSiblingKinds(t *testing.T) {
	widgetStarted := make(chan struct{})
	var widgetOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/widgets") {
			widgetOnce.Do(func() { close(widgetStarted) })
			<-r.Context().Done()
			return
		}
		select {
		case <-widgetStarted:
		case <-r.Context().Done():
			return
		}
		select {
		case <-time.After(160 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		if r.URL.Query().Get("continue") == "" {
			writeCatalogListPage(w, "Gadget", "default", "first", "second")
			return
		}
		writeCatalogListPage(w, "Gadget", "default", "second", "")
	}))
	defer server.Close()
	client, err := dynamic.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)

	svc := NewService(Dependencies{ClusterID: "c1", Common: common.Dependencies{DynamicClient: client}}, &Options{ListRequestTimeout: 250 * time.Millisecond, ListWorkers: 2})
	svc.discoveryClient = &stubDiscovery{lists: []*metav1.APIResourceList{{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{
		{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list"}},
		{Name: "gadgets", Kind: "Gadget", Namespaced: true, Verbs: []string{"list"}},
	}}}}
	old := summaryFromObject("c1", widgetDesc(), widgetObject("default", "retained", "1"))
	svc.items[catalogKey(widgetDesc(), "default", "retained")] = old
	svc.catalogIndex.rebuildCacheFromItems(svc.items, []Descriptor{widgetDesc()})
	err = svc.sync(t.Context())
	var partial *PartialSyncError
	require.ErrorAs(t, err, &partial)
	require.Equal(t, []string{widgetDesc().GVR().String()}, partial.FailedDescriptors)
	require.Equal(t, 2, svc.Query(QueryOptions{Kinds: []string{"Gadget"}}).TotalItems, "the healthy kind must finish after its sibling times out")
	require.Equal(t, []Summary{old}, svc.Query(QueryOptions{Kinds: []string{"Widget"}}).Items)
}

func writeCatalogListPage(w http.ResponseWriter, kind, namespace, name, next string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"apiVersion": "example.com/v1", "kind": kind + "List", "metadata": map[string]string{"resourceVersion": "1", "continue": next},
		"items": []interface{}{map[string]interface{}{"apiVersion": "example.com/v1", "kind": kind, "metadata": map[string]string{"namespace": namespace, "name": name, "uid": fmt.Sprintf("%s-%s-%s", kind, namespace, name), "resourceVersion": "1"}}},
	})
}
