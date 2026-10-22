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

// SubscribeBundleSink registers a bundle sink after the store may already hold
// rows: it replays every current bundle as an upsert under the store lock, then
// delivers each later change. The replay stands in for a restore seed. The
// returned func detaches the sink.
func (s *ProjectingStore) SubscribeBundleSink(sink BundleSink) func() {
	if sink == nil {
		return func() {
			// A nil sink is never registered, so there is nothing to detach.
		}
	}
	subscription := &bundleSubscription{BundleSink: sink}
	var observer BundleSink = subscription
	if _, bulk := sink.(BundleReplacer); bulk {
		observer = &bundleReplacingSubscription{subscription}
	}
	s.mu.Lock()
	s.bundleSinks = append(s.bundleSinks, observer)
	for _, row := range s.rows {
		if bundle, ok := row.(Bundle); ok {
			sink.UpsertBundle(bundle)
		}
	}
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.bundleSinks = slices.DeleteFunc(s.bundleSinks, func(candidate BundleSink) bool { return candidate == observer })
	}
}

// Each subscription gets its own identity for detachment; a sink that takes
// a relist's complete set keeps that contract through the wrapper.
type bundleSubscription struct{ BundleSink }
type bundleReplacingSubscription struct{ *bundleSubscription }

func (s *bundleReplacingSubscription) ReplaceBundles(rows []Bundle) {
	s.BundleSink.(BundleReplacer).ReplaceBundles(rows)
}

func (m *IngestManager) SubscribeBundleSink(gvr schema.GroupVersionResource, sink BundleSink) func() {
	store := m.StoreFor(gvr)
	if store == nil {
		return func() {
			// No store backs this resource, so no sink was registered to detach.
		}
	}
	return store.SubscribeBundleSink(sink)
}
