package backend

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type stubHandler struct {
	mu     sync.Mutex
	called bool
}

func (h *stubHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	h.called = true
	h.mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func (h *stubHandler) WasCalled() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.called
}

func TestAggregateContainerLogsStreamHandlerRoutesByCluster(t *testing.T) {
	handlerA := &stubHandler{}
	handlerB := &stubHandler{}
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {Handler: handlerA},
		"cluster-b": {Handler: handlerB},
	}
	aggregate := newAggregateContainerLogsStreamHandler(subsystems)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/container-logs?scope=cluster-b|default:/v1:pod:nginx", nil)
	rec := httptest.NewRecorder()
	aggregate.ServeHTTP(rec, req)

	require.True(t, handlerB.WasCalled())
	require.False(t, handlerA.WasCalled())
}
