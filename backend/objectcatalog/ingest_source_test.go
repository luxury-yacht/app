/*
 * backend/objectcatalog/ingest_source_test.go
 *
 * Tests for the ingest-fed catalog paths: sink registration and incremental apply.
 */

package objectcatalog

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/events"
)

// replayIngestSource mirrors ProjectingStore.AddCatalogSink: registering a sink
// synchronously replays the store's current rows through the sink's Replace, exactly
// as the ingest manager does for an already-populated store.
type replayIngestSource struct {
	rows        map[schema.GroupVersionResource][]interface{}
	afterReplay func()
}

func (r replayIngestSource) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	return r.rows[gvr]
}
func (r replayIngestSource) AddCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool {
	if bulk, ok := sink.(ingest.Replacer); ok {
		bulk.Replace(r.rows[gvr])
	}
	if r.afterReplay != nil {
		r.afterReplay()
	}
	return true
}
func (r replayIngestSource) RegisterDynamicCatalogReflector(schema.GroupVersionResource, schema.GroupVersionKind, ingest.CatalogProjector, bool) bool {
	return false
}
func (r replayIngestSource) HasSyncedFor(schema.GroupVersionResource) bool { return true }
func (r replayIngestSource) Tracks(schema.GroupVersionResource) bool       { return true }

// Registration reconciles every built-in kind itself and drops their queued
// work, but a custom resource queued at the same time must stay queued: here a
// deleted CRD's reconcile must still clear its rows once the worker reaches it.
func TestRegistrationKeepsQueuedCustomResourceReconciliation(t *testing.T) {
	widgetGVR := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	widget := Descriptor{Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Namespaced: true, Scope: ScopeNamespace}
	svc := NewService(Dependencies{IngestSource: replayIngestSource{rows: map[schema.GroupVersionResource][]interface{}{}}, ClusterID: "cluster-a"}, nil)
	registerDesc(svc, widget)
	svc.replaceIngestCatalogSummaries(widgetGVR, []Summary{{
		Ref:   resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Namespace: "default", Name: "stale"},
		Scope: ScopeNamespace,
	}})
	require.Equal(t, 1, svc.Query(QueryOptions{}).TotalItems)

	// The drain worker is busy with another kind when the retired Widget
	// source's reconcile is queued.
	done := make(chan struct{})
	svc.ingestPendingMu.Lock()
	svc.ingestPending = map[schema.GroupVersionResource]struct{}{widgetGVR: {}}
	svc.ingestDrainDone = done
	svc.ingestPendingMu.Unlock()

	svc.registerIngestCatalogSinks()
	svc.drainIngestReconciliation(done)

	require.Zero(t, svc.Query(QueryOptions{}).TotalItems, "registration dropped the queued Widget reconcile")
}

// TestRegisterIngestCatalogSinksRebuildsCacheOnce pins the batched registration:
// every cut kind's replay lands in the catalog index, but the O(all-items) published
// cache rebuild + broadcast happens exactly ONCE for the whole registration loop —
// not once per kind, right in the startup window when the app is busiest.
func TestRegisterIngestCatalogSinksRebuildsCacheOnce(t *testing.T) {
	rows := make(map[schema.GroupVersionResource][]interface{}, len(catalogIngestGVRs))
	source := replayIngestSource{rows: rows}
	svc := NewService(Dependencies{IngestSource: source}, nil)

	// Seed a descriptor + one replay row for every cut kind, so each registration's
	// replay resolves and applies (an unresolvable kind would skip its rebuild and
	// mask the per-kind cost this test pins).
	svc.mu.Lock()
	for gvr := range catalogIngestGVRs {
		desc := Descriptor{
			Kind:     gvr.Resource, // any stable non-empty kind; matching matters, not naming
			Group:    gvr.Group,
			Version:  gvr.Version,
			Resource: gvr.Resource,
		}
		svc.catalogIndex.setResource(gvr.String(), desc)
		rows[gvr] = []interface{}{Summary{Ref: resourcemodel.ResourceRef{Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: "default", Name: "seed-" + desc.Resource}}}
	}
	svc.mu.Unlock()

	before := svc.cacheRebuilds.Load()
	svc.registerIngestCatalogSinks()
	rebuilds := svc.cacheRebuilds.Load() - before

	if rebuilds != 1 {
		t.Fatalf("sink registration must rebuild the published cache exactly once, got %d rebuilds for %d kinds",
			rebuilds, len(catalogIngestGVRs))
	}

	// Every kind's replayed row must still be present after the single rebuild.
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	for gvr := range catalogIngestGVRs {
		found := false
		for _, item := range svc.catalogIndex.items {
			if item.Ref.Resource == gvr.Resource && item.Ref.Group == gvr.Group {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("replayed row for %s missing from the catalog index after batched registration", gvr)
		}
	}
}

func TestConcurrentIngestUpdatesBothReachCatalog(t *testing.T) {
	rows := make(map[schema.GroupVersionResource][]interface{})
	svc := NewService(Dependencies{IngestSource: replayIngestSource{rows: rows}, ClusterID: "cluster-a"}, nil)
	gvr := schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	desc := Descriptor{Kind: "Pod", Version: "v1", Resource: "pods", Group: gvr.Group, Namespaced: true}
	svc.catalogIndex.setResource(gvr.String(), desc)
	secondGVR := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	secondDesc := Descriptor{Kind: "ConfigMap", Version: "v1", Resource: "configmaps", Group: secondGVR.Group, Namespaced: true}
	svc.catalogIndex.setResource(secondGVR.String(), secondDesc)
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	svc.now = func() time.Time { once.Do(func() { close(entered); <-release }); return time.Unix(1, 0) }
	row := func(name string) Summary {
		return Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: name}}
	}
	rows[gvr] = []interface{}{row("first")}
	secondRow := row("second")
	secondRow.Ref.Kind = "ConfigMap"
	secondRow.Ref.Resource = "configmaps"
	rows[secondGVR] = []interface{}{secondRow}
	firstDone := make(chan struct{})
	go func() { defer close(firstDone); svc.applyIngestCatalogSummary(gvr, row("first"), false) }()
	<-entered
	secondDone := make(chan struct{})
	go func() {
		defer close(secondDone)
		secondRow := row("second")
		secondRow.Ref.Kind = "ConfigMap"
		secondRow.Ref.Resource = "configmaps"
		svc.applyIngestCatalogSummary(secondGVR, secondRow, false)
	}()
	select {
	case <-secondDone:
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	<-firstDone
	<-secondDone
	deadline := time.After(time.Second)
	for {
		svc.mu.RLock()
		count := len(svc.items)
		svc.mu.RUnlock()
		if count == 2 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("concurrent callbacks kept %d of 2 rows", count)
		case <-time.After(time.Millisecond):
		}
	}
}

// A bulk replay is reconciled from the store's authoritative rows after the
// store callback returns, and a retired catalog starts no more reconciliation.
func TestIngestReplayReconcilesAuthoritativeRows(t *testing.T) {
	gvr := schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	desc := Descriptor{Kind: "Pod", Version: "v1", Resource: "pods", Group: gvr.Group, Namespaced: true}
	row := Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "latest"}}
	svc := NewService(Dependencies{IngestSource: replayIngestSource{rows: map[schema.GroupVersionResource][]interface{}{gvr: {row}}}, ClusterID: "cluster-a"}, nil)
	svc.catalogIndex.setResource(gvr.String(), desc)
	sink := ingestCatalogSink{service: svc, gvr: gvr}
	sink.Replace(nil)
	deadline := time.After(time.Second)
	for {
		svc.mu.RLock()
		count := len(svc.items)
		svc.mu.RUnlock()
		if count == 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("the replay never reconciled authoritative rows")
		case <-time.After(time.Millisecond):
		}
	}
	svc.stopIngestReconciliation()
	sink.Replace(nil)
	svc.ingestPendingMu.Lock()
	defer svc.ingestPendingMu.Unlock()
	if svc.ingestDrainDone != nil || len(svc.ingestPending) != 0 {
		t.Fatal("retired catalog spawned another reconciliation")
	}
}

// waitForIngestReconciliation waits until queued replays have reconciled.
func waitForIngestReconciliation(t *testing.T, svc *Service) {
	t.Helper()
	require.Eventually(t, func() bool {
		svc.ingestPendingMu.Lock()
		defer svc.ingestPendingMu.Unlock()
		return svc.ingestDrainDone == nil && len(svc.ingestPending) == 0
	}, time.Second, time.Millisecond)
}

// replaceIngestCatalogSummaries publishes a bulk replacement of gvr's rows the
// way the partition-aware reconcile does, under the catalog's sync lock.
func (s *Service) replaceIngestCatalogSummaries(gvr schema.GroupVersionResource, rows []Summary) {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	s.replaceIngestCatalogSummariesLocked(gvr, rows)
}

func (replayIngestSource) ReadDynamicCatalogSource(schema.GroupResource) (ingest.DynamicCatalogSnapshot, bool) {
	return ingest.DynamicCatalogSnapshot{}, false
}
func (replayIngestSource) SubscribeDynamicCatalogChanges(func(ingest.DynamicCatalogChange)) func() {
	return func() {}
}

func (replayIngestSource) IsDynamicCatalogGeneration(schema.GroupResource, uint64) bool { return false }

func (replayIngestSource) ReconcileDiscoveredResource(schema.GroupVersionResource) bool { return false }

func (source replayIngestSource) SubscribeCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) func() {
	source.AddCatalogSink(gvr, sink)
	return func() {}
}

func (replayIngestSource) SubscribeBundleSink(schema.GroupVersionResource, ingest.BundleSink) func() {
	return func() {}
}

// PartitionReadinessFor reports the one Ready cluster-wide partition the ingest
// manager reports for a synced, unscoped store.
func (replayIngestSource) PartitionReadinessFor(schema.GroupVersionResource) []ingest.PartitionReadiness {
	return []ingest.PartitionReadiness{{State: refresh.ResourceReadinessReady}}
}

// subscriptionRecordingSource records which kinds the catalog subscribes to.
type subscriptionRecordingSource struct {
	replayIngestSource
	subscribed map[schema.GroupVersionResource]bool
}

func (source subscriptionRecordingSource) SubscribeCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) func() {
	source.subscribed[gvr] = true
	return source.replayIngestSource.SubscribeCatalogSink(gvr, sink)
}

// The catalog subscribes to the ingest rows of every kind it collects, and to
// no kind it excludes: Events are fed by an owned reflector but are not
// catalog objects, and their row volume must not reach the catalog's sink.
func TestCatalogSubscribesToTheIngestRowsOfCollectedKindsOnly(t *testing.T) {
	source := subscriptionRecordingSource{subscribed: map[schema.GroupVersionResource]bool{}}
	svc := NewService(Dependencies{IngestSource: source}, nil)
	svc.registerIngestCatalogSinks()

	want := map[schema.GroupVersionResource]bool{}
	for _, descriptor := range kindregistry.All {
		if descriptor.CatalogSource != kindspec.CatalogNone {
			want[descriptor.Identity.GVR()] = true
		}
	}
	require.Equal(t, want, source.subscribed)
	require.NotContains(t, source.subscribed, events.Identity.GVR())
}
