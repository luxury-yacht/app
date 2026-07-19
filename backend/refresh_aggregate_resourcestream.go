package backend

import (
	"net/http"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// aggregateResourceStreamHandler multiplexes resource stream subscriptions across clusters.
//
// Manager/name lookups go through the handler's LIVE maps (topologyMu):
// WebSocket sessions bind the adapter once at connect, so Update must change
// what that same adapter resolves — a rebuilt mux with a fresh map would leave
// every existing session rejecting late-connecting clusters forever.
type aggregateResourceStreamHandler struct {
	mux      *streammux.Handler
	logger   containerlogsstream.Logger
	recorder *telemetry.Recorder
	mu       sync.RWMutex

	topologyMu   sync.RWMutex
	managers     map[string]*resourcestream.Manager
	clusterNames map[string]string
}

func (h *aggregateResourceStreamHandler) setTopology(subsystems map[string]*system.Subsystem) []string {
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
	h.topologyMu.Lock()
	previousManagers := h.managers
	h.managers = managers
	h.clusterNames = clusterNames
	h.topologyMu.Unlock()

	replacedClusterIDs := make([]string, 0)
	for clusterID, previousManager := range previousManagers {
		if previousManager != nil && managers[clusterID] != previousManager {
			replacedClusterIDs = append(replacedClusterIDs, clusterID)
		}
	}
	return replacedClusterIDs
}

func (h *aggregateResourceStreamHandler) managerFor(clusterID string) *resourcestream.Manager {
	h.topologyMu.RLock()
	defer h.topologyMu.RUnlock()
	return h.managers[clusterID]
}

func (h *aggregateResourceStreamHandler) clusterNameFor(clusterID string) string {
	h.topologyMu.RLock()
	defer h.topologyMu.RUnlock()
	return h.clusterNames[clusterID]
}

// sessionAdapter is the adapter sessions bind at connect time; it resolves
// managers from the handler's live topology on every call.
func (h *aggregateResourceStreamHandler) sessionAdapter() *resourcestream.ClusterAdapter {
	return resourcestream.NewResolvingClusterAdapter(h.managerFor)
}

// newAggregateResourceStreamHandler builds a multiplexed resource stream handler for all clusters.
func newAggregateResourceStreamHandler(
	subsystems map[string]*system.Subsystem,
	logger containerlogsstream.Logger,
	recorder *telemetry.Recorder,
) (*aggregateResourceStreamHandler, error) {
	if logger == nil {
		logger = applog.Noop
	}

	handler := &aggregateResourceStreamHandler{
		logger:   logger,
		recorder: recorder,
	}
	handler.setTopology(subsystems)

	mux, err := streammux.NewHandler(streammux.Config{
		Adapter:                    handler.sessionAdapter(),
		Logger:                     logger,
		Telemetry:                  recorder,
		StreamName:                 telemetry.StreamResources,
		SendReset:                  true,
		AllowClusterScopedRequests: true,
		ResolveClusterName:         handler.clusterNameFor,
	})
	if err != nil {
		return nil, err
	}
	handler.mux = mux
	return handler, nil
}

// ServeHTTP upgrades the websocket and multiplexes resource subscriptions.
func (h *aggregateResourceStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	mux := h.mux
	h.mu.RUnlock()
	mux.ServeHTTP(w, r)
}

// Update swaps the live cluster topology after selection changes. Existing
// sessions stay connected; subscriptions for replaced managers receive
// COMPLETE and re-subscribe through the adapter's new topology.
func (h *aggregateResourceStreamHandler) Update(subsystems map[string]*system.Subsystem) error {
	if h == nil {
		return nil
	}
	replacedClusterIDs := h.setTopology(subsystems)
	for _, clusterID := range replacedClusterIDs {
		h.mux.InvalidateClusterSubscriptions(clusterID)
	}
	return nil
}
