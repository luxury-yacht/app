package backend

import (
	"net/http"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// aggregateResourceStreamHandler multiplexes resource stream subscriptions across clusters.
type aggregateResourceStreamHandler struct {
	mux      *streammux.Handler
	logger   logstream.Logger
	recorder *telemetry.Recorder
	mu       sync.RWMutex
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

	return &aggregateResourceStreamHandler{
		mux:      handler,
		logger:   logger,
		recorder: recorder,
	}, nil
}

// ServeHTTP upgrades the websocket and multiplexes resource subscriptions.
func (h *aggregateResourceStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	mux := h.mux
	h.mu.RUnlock()
	mux.ServeHTTP(w, r)
}

// Update rebuilds the resource stream multiplexer after selection changes.
func (h *aggregateResourceStreamHandler) Update(subsystems map[string]*system.Subsystem) error {
	if h == nil {
		return nil
	}
	next, err := newAggregateResourceStreamHandler(subsystems, h.logger, h.recorder)
	if err != nil {
		return err
	}
	h.mu.Lock()
	h.mux = next.mux
	h.mu.Unlock()
	return nil
}
