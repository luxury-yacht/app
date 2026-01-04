package backend

import (
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// aggregateResourceStreamHandler multiplexes resource stream subscriptions across clusters.
type aggregateResourceStreamHandler struct {
	mux *streammux.Handler
}

// newAggregateResourceStreamHandler builds a multiplexed resource stream handler for all clusters.
func newAggregateResourceStreamHandler(
	subsystems map[string]*system.Subsystem,
	logger logstream.Logger,
	recorder *telemetry.Recorder,
) (*aggregateResourceStreamHandler, error) {
	if logger == nil {
		logger = noopLogger{}
	}

	managers := make(map[string]*resourcestream.Manager)
	clusterNames := make(map[string]string)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.ResourceStream == nil {
			continue
		}
		managers[id] = subsystem.ResourceStream
		if subsystem.ClusterMeta.ClusterName != "" {
			clusterNames[id] = subsystem.ClusterMeta.ClusterName
		}
	}
	handler, err := streammux.NewHandler(streammux.Config{
		Adapter:                    resourcestream.NewClusterAdapter(managers),
		Logger:                     logger,
		Telemetry:                  recorder,
		StreamName:                 telemetry.StreamResources,
		SendReset:                  true,
		AllowClusterScopedRequests: true,
		ResolveClusterName: func(clusterID string) string {
			return clusterNames[clusterID]
		},
	})
	if err != nil {
		return nil, err
	}

	return &aggregateResourceStreamHandler{mux: handler}, nil
}

// ServeHTTP upgrades the websocket and multiplexes resource subscriptions.
func (h *aggregateResourceStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mux.ServeHTTP(w, r)
}
