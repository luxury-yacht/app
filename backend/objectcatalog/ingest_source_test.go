/*
 * backend/objectcatalog/ingest_source_test.go
 *
 * Tests for the ingest-fed catalog paths: sink registration and incremental apply.
 */

package objectcatalog

import (
	"testing"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// replayIngestSource mirrors ProjectingStore.AddCatalogSink: registering a sink
// synchronously replays the store's current rows through the sink's Replace, exactly
// as the ingest manager does for an already-populated store.
type replayIngestSource struct {
	rows map[schema.GroupVersionResource][]interface{}
}

func (r replayIngestSource) CatalogRows(schema.GroupVersionResource) []interface{} { return nil }
func (r replayIngestSource) AddCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool {
	if bulk, ok := sink.(ingest.ReplaceSink); ok {
		bulk.Replace(r.rows[gvr])
	}
	return true
}
func (r replayIngestSource) RegisterDynamicCatalogReflector(schema.GroupVersionResource, schema.GroupVersionKind, ingest.CatalogProjector) bool {
	return false
}
func (r replayIngestSource) StopReflectorFor(schema.GroupVersionResource)  {}
func (r replayIngestSource) HasSyncedFor(schema.GroupVersionResource) bool { return true }

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
		rows[gvr] = []interface{}{Summary{
			Kind:      desc.Kind,
			Group:     desc.Group,
			Version:   desc.Version,
			Resource:  desc.Resource,
			Namespace: "default",
			Name:      "seed-" + desc.Resource,
		}}
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
			if item.Resource == gvr.Resource && item.Group == gvr.Group {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("replayed row for %s missing from the catalog index after batched registration", gvr)
		}
	}
}
