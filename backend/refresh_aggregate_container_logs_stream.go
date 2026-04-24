package backend

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateContainerLogsStreamHandler routes container logs stream requests to the requested cluster.
type aggregateContainerLogsStreamHandler struct {
	handlers map[string]http.Handler
	mu       sync.RWMutex
}

// newAggregateContainerLogsStreamHandler builds a container logs stream router for all active clusters.
func newAggregateContainerLogsStreamHandler(subsystems map[string]*system.Subsystem) *aggregateContainerLogsStreamHandler {
	handlers := make(map[string]http.Handler)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.Handler == nil {
			continue
		}
		handlers[id] = subsystem.Handler
	}
	return &aggregateContainerLogsStreamHandler{handlers: handlers}
}

// ServeHTTP forwards the request to the matching cluster handler.
func (h *aggregateContainerLogsStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rawScope := r.URL.Query().Get("scope")
	clusterIDs, _ := refresh.SplitClusterScopeList(rawScope)

	targetID, err := h.selectCluster(clusterIDs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	h.mu.RLock()
	handler := h.handlers[targetID]
	h.mu.RUnlock()
	if handler == nil {
		http.Error(w, fmt.Sprintf("cluster %s not active", targetID), http.StatusBadRequest)
		return
	}
	handler.ServeHTTP(w, r)
}

func (h *aggregateContainerLogsStreamHandler) selectCluster(clusterIDs []string) (string, error) {
	if len(clusterIDs) != 1 {
		return "", fmt.Errorf("container logs stream requires a single cluster scope")
	}
	return clusterIDs[0], nil
}

// Update refreshes the container logs stream handlers after selection changes.
func (h *aggregateContainerLogsStreamHandler) Update(subsystems map[string]*system.Subsystem) {
	if h == nil {
		return
	}
	next := newAggregateContainerLogsStreamHandler(subsystems)
	h.mu.Lock()
	h.handlers = next.handlers
	h.mu.Unlock()
}
