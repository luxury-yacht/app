package resourcestream

import (
	"errors"

	"github.com/luxury-yacht/app/backend/refresh/streammux"
)

// Adapter wires resource stream subscriptions into the shared stream mux.
type Adapter struct {
	manager *Manager
}

// NewAdapter returns an adapter for the provided resource stream manager.
func NewAdapter(manager *Manager) *Adapter {
	return &Adapter{manager: manager}
}

// NormalizeScope ensures resource scopes follow domain-specific rules.
func (a *Adapter) NormalizeScope(domain, scope string) (string, error) {
	return normalizeScopeForDomain(domain, scope)
}

// Subscribe registers a resource stream subscription and exposes it to the mux.
func (a *Adapter) Subscribe(domain, scope string) (*streammux.Subscription, error) {
	if a.manager == nil {
		return nil, errors.New("resource stream manager is required")
	}
	return a.manager.Subscribe(domain, scope)
}
