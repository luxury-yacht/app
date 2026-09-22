package ingest

import (
	"k8s.io/apimachinery/pkg/runtime/schema"
	"slices"
)

type catalogSubscription struct{ Sink }
type catalogReplacingSubscription struct{ *catalogSubscription }

func (s *catalogReplacingSubscription) Replace(rows []interface{}) { s.Sink.(Replacer).Replace(rows) }

// SubscribeCatalogSink replays current rows and returns a detachment that joins
// any in-flight store delivery. Detaching a catalog leaves the generation alive.
func (s *ProjectingStore) SubscribeCatalogSink(sink Sink) func() {
	if sink == nil {
		return func() {
			// A nil sink is never registered, so there is nothing to detach.
		}
	}
	subscription := &catalogSubscription{Sink: sink}
	var observer Sink = subscription
	if _, bulk := sink.(Replacer); bulk {
		observer = &catalogReplacingSubscription{subscription}
	}
	s.AddCatalogSink(observer)
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.catalogSinks = slices.DeleteFunc(s.catalogSinks, func(candidate Sink) bool { return candidate == observer })
	}
}

func (m *IngestManager) SubscribeCatalogSink(gvr schema.GroupVersionResource, sink Sink) func() {
	store := m.StoreFor(gvr)
	if store == nil {
		return func() {
			// No store backs this resource, so no sink was registered to detach.
		}
	}
	return store.SubscribeCatalogSink(sink)
}
