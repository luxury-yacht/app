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

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// replayIngestSource mirrors ProjectingStore.AddCatalogSink: registering a sink
// synchronously replays the store's current rows through the sink's Replace, exactly
// as the ingest manager does for an already-populated store.
type replayIngestSource struct {
	rows map[schema.GroupVersionResource][]interface{}
}

func (r replayIngestSource) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	return r.rows[gvr]
}
func (r replayIngestSource) AddCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool {
	if bulk, ok := sink.(ingest.Replacer); ok {
		bulk.Replace(r.rows[gvr])
	}
	return true
}
func (r replayIngestSource) RegisterDynamicCatalogReflector(schema.GroupVersionResource, schema.GroupVersionKind, ingest.CatalogProjector, bool) bool {
	return false
}
func (r replayIngestSource) StopReflectorFor(schema.GroupVersionResource)  {}
func (r replayIngestSource) HasSyncedFor(schema.GroupVersionResource) bool { return true }
func (r replayIngestSource) Tracks(schema.GroupVersionResource) bool       { return true }

// TestRegisterIngestCatalogSinksRebuildsCacheOnce pins the batched registration:
// every cut kind's replay lands in the catalog index, but the O(all-items) published
// cache rebuild + broadcast happens exactly ONCE for the whole registration loop —
// not once per kind, right in the startup window when the app is busiest.
func TestRegisterIngestCatalogSinksRebuildsCacheOnce(t *testing.T) {
	rows := make(map[schema.GroupVersionResource][]interface{}, len(catalogIngestOwnedGVRs))
	source := replayIngestSource{rows: rows}
	svc := NewService(Dependencies{IngestSource: source}, nil)

	// Seed a descriptor + one replay row for every cut kind, so each registration's
	// replay resolves and applies (an unresolvable kind would skip its rebuild and
	// mask the per-kind cost this test pins).
	svc.mu.Lock()
	for gvr := range catalogIngestOwnedGVRs {
		desc := resourceDescriptor{
			Kind:     gvr.Resource, // any stable non-empty kind; matching matters, not naming
			Group:    gvr.Group,
			Version:  gvr.Version,
			Resource: gvr.Resource,
			GVR:      gvr,
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
			rebuilds, len(catalogIngestOwnedGVRs))
	}

	// Every kind's replayed row must still be present after the single rebuild.
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	for gvr := range catalogIngestOwnedGVRs {
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
	svc := NewService(Dependencies{IngestSource: replayIngestSource{rows: rows}}, nil)
	gvr := schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	desc := resourceDescriptor{Kind: "Pod", Version: "v1", Resource: "pods", GVR: gvr, Namespaced: true}
	svc.catalogIndex.setResource(gvr.String(), desc)
	secondGVR := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	secondDesc := resourceDescriptor{Kind: "ConfigMap", Version: "v1", Resource: "configmaps", GVR: secondGVR, Namespaced: true}
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

func TestContendedIngestReplaceReconcilesAuthoritativeRows(t *testing.T) {
	gvr := schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	desc := resourceDescriptor{Kind: "Pod", Version: "v1", Resource: "pods", GVR: gvr, Namespaced: true}
	row := Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "latest"}}
	svc := NewService(Dependencies{IngestSource: replayIngestSource{rows: map[schema.GroupVersionResource][]interface{}{gvr: {row}}}}, nil)
	svc.catalogIndex.setResource(gvr.String(), desc)
	svc.syncMu.Lock()
	svc.replaceIngestCatalogSummaries(gvr, nil)
	svc.syncMu.Unlock()
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
			t.Fatal("contended Replace never reconciled authoritative rows")
		case <-time.After(time.Millisecond):
		}
	}
	svc.stopIngestReconciliation()
	svc.syncMu.Lock()
	svc.replaceIngestCatalogSummaries(gvr, nil)
	svc.syncMu.Unlock()
	svc.ingestPendingMu.Lock()
	defer svc.ingestPendingMu.Unlock()
	if svc.ingestDrainDone != nil || len(svc.ingestPending) != 0 {
		t.Fatal("retired catalog spawned another reconciliation")
	}
}
