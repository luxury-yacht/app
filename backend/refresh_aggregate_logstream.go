package backend

import (
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateLogStreamHandler routes log stream requests to the requested cluster.
type aggregateLogStreamHandler struct {
	handlers  map[string]http.Handler
}

// newAggregateLogStreamHandler builds a log stream router for all active clusters.
func newAggregateLogStreamHandler(subsystems map[string]*system.Subsystem) *aggregateLogStreamHandler {
	handlers := make(map[string]http.Handler)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.Handler == nil {
			continue
		}
		handlers[id] = subsystem.Handler
	}
	return &aggregateLogStreamHandler{handlers: handlers}
}

// ServeHTTP forwards the request to the matching cluster handler.
func (h *aggregateLogStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rawScope := r.URL.Query().Get("scope")
	clusterIDs, _ := refresh.SplitClusterScopeList(rawScope)

	targetID, err := h.selectCluster(clusterIDs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	handler := h.handlers[targetID]
	if handler == nil {
		http.Error(w, fmt.Sprintf("cluster %s not active", targetID), http.StatusBadRequest)
		return
	}
	handler.ServeHTTP(w, r)
}

func (h *aggregateLogStreamHandler) selectCluster(clusterIDs []string) (string, error) {
	if len(clusterIDs) != 1 {
		return "", fmt.Errorf("log stream requires a single cluster scope")
	}
	return clusterIDs[0], nil
}
