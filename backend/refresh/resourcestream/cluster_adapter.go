package resourcestream

import (
	"errors"

	"github.com/luxury-yacht/app/backend/refresh/streammux"
)

// ClusterAdapter multiplexes resource stream subscriptions across cluster managers.
//
// It resolves managers through a lookup function on EVERY call: WebSocket
// sessions bind their adapter once, at connect time, so a point-in-time
// manager map would blind every existing session to clusters whose subsystems
// come up (or are rebuilt) later — their subscribes fail with "resource stream
// manager not available" until the socket happens to reconnect.
type ClusterAdapter struct {
	resolve func(clusterID string) *Manager
}

// NewClusterAdapter builds a cluster-aware resource stream adapter over a
// fixed manager map (tests, single-shot wiring). Live topologies should use
// NewResolvingClusterAdapter.
func NewClusterAdapter(managers map[string]*Manager) *ClusterAdapter {
	return NewResolvingClusterAdapter(func(clusterID string) *Manager {
		return managers[clusterID]
	})
}

// NewResolvingClusterAdapter builds an adapter that resolves the cluster's
// manager at call time, so topology changes reach already-bound sessions.
func NewResolvingClusterAdapter(resolve func(clusterID string) *Manager) *ClusterAdapter {
	return &ClusterAdapter{resolve: resolve}
}

// ParseSelector converts the websocket transport scope into the typed resource
// stream selector used below the adapter seam.
func (a *ClusterAdapter) ParseSelector(clusterID, domain, scope string) (streammux.Selector, error) {
	return ParseStreamSelector(clusterID, domain, scope)
}

// Subscribe registers a subscription against the selector's cluster manager.
func (a *ClusterAdapter) Subscribe(selector streammux.Selector) (*streammux.Subscription, error) {
	resourceSelector, err := resourceStreamSelector(selector)
	if err != nil {
		return nil, err
	}
	manager, err := a.managerFor(resourceSelector.ClusterID)
	if err != nil {
		return nil, err
	}
	return manager.SubscribeSelector(resourceSelector)
}

// Resume returns buffered updates for the selector's cluster manager.
func (a *ClusterAdapter) Resume(selector streammux.Selector, since uint64) ([]streammux.ServerMessage, bool) {
	resourceSelector, err := resourceStreamSelector(selector)
	if err != nil {
		return nil, false
	}
	manager, err := a.managerFor(resourceSelector.ClusterID)
	if err != nil {
		return nil, false
	}
	return manager.ResumeSelector(resourceSelector, since)
}

func (a *ClusterAdapter) managerFor(clusterID string) (*Manager, error) {
	if a == nil || a.resolve == nil {
		return nil, errors.New("resource stream adapter is required")
	}
	if clusterID == "" {
		return nil, errors.New("cluster id is required")
	}
	manager := a.resolve(clusterID)
	if manager == nil {
		return nil, errors.New("resource stream manager not available")
	}
	return manager, nil
}
