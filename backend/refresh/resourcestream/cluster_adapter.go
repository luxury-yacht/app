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

// NormalizeScope applies resource scope normalization shared across clusters.
func (a *ClusterAdapter) NormalizeScope(domain, scope string) (string, error) {
	return normalizeScopeForDomain(domain, scope)
}

// Subscribe registers a subscription without a cluster identifier.
func (a *ClusterAdapter) Subscribe(domain, scope string) (*streammux.Subscription, error) {
	return nil, errors.New("cluster id is required for resource stream subscriptions")
}

// Resume is unsupported without a cluster identifier.
func (a *ClusterAdapter) Resume(domain, scope string, since uint64) ([]streammux.ServerMessage, bool) {
	return nil, false
}

// SubscribeCluster registers a subscription against the requested cluster manager.
func (a *ClusterAdapter) SubscribeCluster(clusterID, domain, scope string) (*streammux.Subscription, error) {
	manager, err := a.managerFor(clusterID)
	if err != nil {
		return nil, err
	}
	return manager.Subscribe(domain, scope)
}

// ResumeCluster returns buffered updates for the requested cluster manager.
func (a *ClusterAdapter) ResumeCluster(
	clusterID, domain, scope string,
	since uint64,
) ([]streammux.ServerMessage, bool) {
	manager, err := a.managerFor(clusterID)
	if err != nil {
		return nil, false
	}
	return manager.Resume(domain, scope, since)
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
