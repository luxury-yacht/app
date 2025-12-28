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

func TestAggregateCatalogStreamRoutesToPrimary(t *testing.T) {
	// Without a cluster scope, the primary handler should receive the request.
	primary := &captureHandler{status: http.StatusOK, body: "primary"}
	secondary := &captureHandler{status: http.StatusOK, body: "secondary"}
	handler := newAggregateCatalogStreamHandler("cluster-a", map[string]*system.Subsystem{
		"cluster-a": {Handler: primary},
		"cluster-b": {Handler: secondary},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog?limit=50", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.True(t, primary.called)
	require.False(t, secondary.called)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "primary")
}

func TestAggregateCatalogStreamRejectsNonPrimaryCluster(t *testing.T) {
	// Catalog streaming must target the primary cluster only.
	primary := &captureHandler{status: http.StatusOK, body: "primary"}
	handler := newAggregateCatalogStreamHandler("cluster-a", map[string]*system.Subsystem{
		"cluster-a": {Handler: primary},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog", nil)
	req.URL.RawQuery = "cluster-b|limit=25"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "catalog stream is only available on the primary cluster")
}

func TestAggregateCatalogStreamRejectsMultipleClusters(t *testing.T) {
	// The catalog stream can only select a single cluster scope.
	primary := &captureHandler{status: http.StatusOK, body: "primary"}
	handler := newAggregateCatalogStreamHandler("cluster-a", map[string]*system.Subsystem{
		"cluster-a": {Handler: primary},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog", nil)
	req.URL.RawQuery = "clusters=cluster-a,cluster-b|limit=25"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "catalog stream requires a single cluster")
}

func TestAggregateCatalogStreamRejectsMissingPrimary(t *testing.T) {
	// A missing primary cluster should surface a clear error message.
	handler := newAggregateCatalogStreamHandler("", map[string]*system.Subsystem{})
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/catalog?limit=25", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "primary cluster not available")
}
