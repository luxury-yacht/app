package backend

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRefreshServiceBlocksEarlyRequestsUntilPublication(t *testing.T) {
	app := NewApp(nil)
	recorder := httptest.NewRecorder()
	app.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/snapshots/pods", nil))
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)

	mux := http.NewServeMux()
	mux.HandleFunc("/snapshots/pods", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	app.publishRefreshService(mux, nil)

	recorder = httptest.NewRecorder()
	app.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/snapshots/pods", nil))
	require.Equal(t, http.StatusNoContent, recorder.Code)
}

func setRefreshServiceReadyForTest(app *App) {
	app.refreshService.Store(&refreshServiceHandler{handler: http.NotFoundHandler()})
}
