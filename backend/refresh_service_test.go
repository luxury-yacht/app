package backend

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRefreshServiceBlocksEarlyRequestsUntilPublication(t *testing.T) {
	app := newRefreshCoordinatorTestFixture(t)
	recorder := httptest.NewRecorder()
	app.Refresh.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/snapshots/pods", nil))
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)

	mux := http.NewServeMux()
	mux.HandleFunc("/snapshots/pods", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	app.Refresh.publishRefreshService(mux, nil)

	recorder = httptest.NewRecorder()
	app.Refresh.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/snapshots/pods", nil))
	require.Equal(t, http.StatusNoContent, recorder.Code)
}

func setRefreshServiceReadyForTest(refreshCoordinator *RefreshCoordinator) {
	refreshCoordinator.refreshService.Store(&refreshServiceHandler{handler: http.NotFoundHandler()})
}
