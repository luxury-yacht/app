package backend

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateCatalogStreamHandler routes catalog streams to the requested cluster.
type aggregateCatalogStreamHandler struct {
	handlers map[string]http.Handler
	mu       sync.RWMutex
}

// newAggregateCatalogStreamHandler builds a catalog stream router for active clusters.
func newAggregateCatalogStreamHandler(subsystems map[string]*system.Subsystem) *aggregateCatalogStreamHandler {
	handlers := make(map[string]http.Handler)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.Handler == nil {
			continue
		}
		handlers[id] = subsystem.Handler
	}
	return &aggregateCatalogStreamHandler{
		handlers: handlers,
	}
}

// ServeHTTP forwards catalog stream requests after validating the cluster scope.
func (h *aggregateCatalogStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rawScope := r.URL.RawQuery
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

func (h *aggregateCatalogStreamHandler) selectCluster(clusterIDs []string) (string, error) {
	if len(clusterIDs) != 1 {
		return "", fmt.Errorf("catalog stream requires a single cluster scope")
	}
	return clusterIDs[0], nil
}

// Update refreshes the catalog stream handlers after selection changes.
func (h *aggregateCatalogStreamHandler) Update(subsystems map[string]*system.Subsystem) {
	if h == nil {
		return
	}
	next := newAggregateCatalogStreamHandler(subsystems)
	h.mu.Lock()
	h.handlers = next.handlers
	h.mu.Unlock()
}
