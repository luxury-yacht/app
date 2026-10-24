package backend

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

func TestRefreshServiceBlocksEarlyRequestsUntilPublication(t *testing.T) {
	app := newRefreshCoordinatorTestFixture(t)
	recorder := httptest.NewRecorder()
	app.Refresh.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/snapshots/pods", nil))
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	// The early rejection is the same typed status as every other refresh
	// error, so the frontend recognizes start-up by reason, not by text.
	require.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
	var status errorstatus.Status
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &status))
	require.Equal(t, errorstatus.ReasonRefreshUnavailable, status.Reason)
	require.True(t, status.Retryable)

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
