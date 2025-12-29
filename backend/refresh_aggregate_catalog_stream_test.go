package backend

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type captureHandler struct {
	called bool
	body   string
	status int
}

func (h *captureHandler) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	h.called = true
	if h.status != 0 {
		w.WriteHeader(h.status)
	}
	if h.body != "" {
		_, _ = w.Write([]byte(h.body))
	}
}

func TestAggregateCatalogStreamRoutesToRequestedCluster(t *testing.T) {
	clusterA := &captureHandler{status: http.StatusOK, body: "cluster-a"}
	clusterB := &captureHandler{status: http.StatusOK, body: "cluster-b"}
	handler := newAggregateCatalogStreamHandler(map[string]*system.Subsystem{
		"cluster-a": {Handler: clusterA},
		"cluster-b": {Handler: clusterB},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog", nil)
	req.URL.RawQuery = "cluster-b|limit=50"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.False(t, clusterA.called)
	require.True(t, clusterB.called)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "cluster-b")
}

func TestAggregateCatalogStreamRejectsMultipleClusters(t *testing.T) {
	// The catalog stream can only select a single cluster scope.
	handler := newAggregateCatalogStreamHandler(map[string]*system.Subsystem{
		"cluster-a": {Handler: &captureHandler{status: http.StatusOK, body: "cluster-a"}},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog", nil)
	req.URL.RawQuery = "clusters=cluster-a,cluster-b|limit=25"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "catalog stream requires a single cluster scope")
}

func TestAggregateCatalogStreamRejectsMissingClusterScope(t *testing.T) {
	handler := newAggregateCatalogStreamHandler(map[string]*system.Subsystem{})
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog?limit=25", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "catalog stream requires a single cluster scope")
}
