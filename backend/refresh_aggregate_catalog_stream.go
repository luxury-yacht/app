package backend

import (
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateCatalogStreamHandler routes catalog streams to the primary cluster.
type aggregateCatalogStreamHandler struct {
	primaryID string
	handlers  map[string]http.Handler
}

// newAggregateCatalogStreamHandler builds a catalog stream router for active clusters.
func newAggregateCatalogStreamHandler(primaryID string, subsystems map[string]*system.Subsystem) *aggregateCatalogStreamHandler {
	handlers := make(map[string]http.Handler)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.Handler == nil {
			continue
		}
		handlers[id] = subsystem.Handler
	}
	return &aggregateCatalogStreamHandler{
		primaryID: primaryID,
		handlers:  handlers,
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
	handler := h.handlers[targetID]
	if handler == nil {
		http.Error(w, fmt.Sprintf("cluster %s not active", targetID), http.StatusBadRequest)
		return
	}
	handler.ServeHTTP(w, r)
}

func (h *aggregateCatalogStreamHandler) selectCluster(clusterIDs []string) (string, error) {
	if len(clusterIDs) == 0 {
		if h.primaryID == "" {
			return "", fmt.Errorf("primary cluster not available")
		}
		return h.primaryID, nil
	}
	if len(clusterIDs) > 1 {
		return "", fmt.Errorf("catalog stream requires a single cluster")
	}
	if clusterIDs[0] != h.primaryID {
		return "", fmt.Errorf("catalog stream is only available on the primary cluster")
	}
	return clusterIDs[0], nil
}
