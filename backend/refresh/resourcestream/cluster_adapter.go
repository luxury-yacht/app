package resourcestream

import (
	"errors"

	"github.com/luxury-yacht/app/backend/refresh/streammux"
)

// ClusterAdapter multiplexes resource stream subscriptions across cluster managers.
type ClusterAdapter struct {
	managers map[string]*Manager
}

// NewClusterAdapter builds a cluster-aware resource stream adapter.
func NewClusterAdapter(managers map[string]*Manager) *ClusterAdapter {
	return &ClusterAdapter{managers: managers}
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
	if a == nil {
		return nil, errors.New("resource stream adapter is required")
	}
	if clusterID == "" {
		return nil, errors.New("cluster id is required")
	}
	manager := a.managers[clusterID]
	if manager == nil {
		return nil, errors.New("resource stream manager not available")
	}
	return manager, nil
}
