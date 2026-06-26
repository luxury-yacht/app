package backend

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// Stream error responses must carry CORS headers, or the browser blocks them
// and the console shows an opaque CORS failure instead of the real status —
// e.g. the 400 "cluster not active" during cluster initialization.
func TestStreamCORSCarriesHeadersOnErrorResponses(t *testing.T) {
	handler := withStreamCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "cluster not active", http.StatusBadRequest)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/resources", nil)
	req.Header.Set("Origin", "wails://wails.localhost:34115")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Equal(t, "wails://wails.localhost:34115", rec.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"))
	require.Contains(t, rec.Body.String(), "not active")
}

func TestStreamCORSFallsBackToWildcardWithoutOrigin(t *testing.T) {
	handler := withStreamCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "cluster not active", http.StatusBadRequest)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/resources", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	require.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))
}

func TestStreamCORSAnswersPreflight(t *testing.T) {
	handler := withStreamCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "cluster not active", http.StatusBadRequest)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v2/stream/resources", nil)
	req.Header.Set("Origin", "wails://wails.localhost:34115")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, "wails://wails.localhost:34115", rec.Header().Get("Access-Control-Allow-Origin"))
	require.Contains(t, rec.Header().Get("Access-Control-Allow-Methods"), http.MethodGet)
}
