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

// ParseSelector converts the websocket transport scope into the typed resource
// stream selector used below the adapter seam.
func (a *Adapter) ParseSelector(clusterID, domain, scope string) (streammux.Selector, error) {
	return ParseStreamSelector(clusterID, domain, scope)
}

// Subscribe registers a resource stream subscription and exposes it to the mux.
func (a *Adapter) Subscribe(selector streammux.Selector) (*streammux.Subscription, error) {
	if a.manager == nil {
		return nil, errors.New("resource stream manager is required")
	}
	resourceSelector, err := resourceStreamSelector(selector)
	if err != nil {
		return nil, err
	}
	return a.manager.SubscribeSelector(resourceSelector)
}

// Resume returns buffered updates after the provided resume token.
func (a *Adapter) Resume(selector streammux.Selector, since uint64) ([]streammux.ServerMessage, bool) {
	if a.manager == nil {
		return nil, false
	}
	resourceSelector, err := resourceStreamSelector(selector)
	if err != nil {
		return nil, false
	}
	return a.manager.ResumeSelector(resourceSelector, since)
}

func resourceStreamSelector(selector streammux.Selector) (StreamSelector, error) {
	resourceSelector, ok := selector.(StreamSelector)
	if !ok {
		return StreamSelector{}, errors.New("resource stream selector is required")
	}
	return resourceSelector, nil
}
