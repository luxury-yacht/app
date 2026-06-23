/*
 * backend/refresh/system/ingest_hub.go
 *
 * ingestInformerHub composes the shared informer factory with the owned-reflector
 * IngestManager behind one refresh.InformerHub, so the refresh manager's single
 * Start/HasSynced/ResourcesSettled/Shutdown lifecycle drives both. Ingest-owned
 * (cut) kinds are no longer registered with the factory, so their readiness comes
 * from the ingest manager; every other kind's readiness comes from the factory.
 */

package system

import (
	"context"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// ingestInformerHub adapts a *informer.Factory plus a *ingest.IngestManager to the
// refresh.InformerHub interface. The factory remains the readiness source for every
// uncut kind; the ingest manager is the readiness source for the cut kinds (whose
// informers the factory no longer registers).
type ingestInformerHub struct {
	factory *informer.Factory
	ingest  *ingest.IngestManager

	// ingestKeys is the set of canonical resource keys (permissions.ResourceKey
	// format) the ingest manager owns, so ResourcesSettled routes each requested key
	// to the right readiness source. Built once from the registry's IngestOwned facet.
	ingestKeys map[string]struct{}
}

// newIngestInformerHub builds the composite hub. ingestManager may be nil, in which
// case the hub is a thin pass-through to the factory (no cut kinds wired).
func newIngestInformerHub(factory *informer.Factory, ingestManager *ingest.IngestManager) *ingestInformerHub {
	keys := make(map[string]struct{})
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		keys[permissions.ResourceKey(d.Identity.Group, d.Identity.Resource)] = struct{}{}
	}
	return &ingestInformerHub{factory: factory, ingest: ingestManager, ingestKeys: keys}
}

var _ refresh.InformerHub = (*ingestInformerHub)(nil)

// Start starts the factory (blocking on its sync gate) and then the ingest manager,
// blocking until every ingest store has completed its initial relist — so the
// composite reports synced only when both sources are ready, the precondition for the
// cut domains serving from populated stores.
func (h *ingestInformerHub) Start(ctx context.Context) error {
	if err := h.factory.Start(ctx); err != nil {
		return err
	}
	if h.ingest == nil {
		return nil
	}
	h.ingest.Start(ctx)
	return waitForIngestSynced(ctx, h.ingest)
}

// waitForIngestSynced blocks until the ingest manager reports HasSynced or ctx ends.
// It polls on the same cadence the factory's settle loop uses; the ingest reflectors
// converge in the same order of magnitude as the typed informers they replace.
func waitForIngestSynced(ctx context.Context, mgr *ingest.IngestManager) error {
	if mgr.HasSynced() {
		return nil
	}
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if mgr.HasSynced() {
				return nil
			}
		}
	}
}

// HasSynced reports synced only when both the factory and the ingest manager are.
func (h *ingestInformerHub) HasSynced(ctx context.Context) bool {
	if !h.factory.HasSynced(ctx) {
		return false
	}
	if h.ingest == nil {
		return true
	}
	return h.ingest.HasSynced()
}

// ResourcesSettled routes each requested key to its readiness source: ingest-owned
// keys are settled when the ingest store for that GVR has synced; every other key is
// delegated to the factory. A key the ingest manager has no entry for (skipped kind)
// is treated as settled, matching the factory's "no informer = settled" rule.
func (h *ingestInformerHub) ResourcesSettled(keys []string) bool {
	if len(keys) == 0 {
		return true
	}
	factoryKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		if _, owned := h.ingestKeys[key]; owned {
			if h.ingest != nil && !h.ingestKeySettled(key) {
				return false
			}
			continue
		}
		factoryKeys = append(factoryKeys, key)
	}
	if len(factoryKeys) == 0 {
		return true
	}
	return h.factory.ResourcesSettled(factoryKeys)
}

// ingestKeySettled reports whether the ingest store(s) backing a canonical resource
// key have synced. A cut domain may declare several ingest-owned keys; each maps to
// one GVR via the registry, so the key is settled when that GVR's store has synced or
// has no entry (the kind was skipped).
func (h *ingestInformerHub) ingestKeySettled(key string) bool {
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		if permissions.ResourceKey(d.Identity.Group, d.Identity.Resource) != key {
			continue
		}
		gvr := d.Identity.GVR()
		if h.ingest.StoreFor(gvr) == nil {
			// No reflector for this kind (skipped — no client/scheme); nothing to wait on.
			return true
		}
		return h.ingest.HasSyncedFor(gvr)
	}
	return true
}

// Shutdown stops the ingest reflectors and the factory.
func (h *ingestInformerHub) Shutdown() error {
	if h.ingest != nil {
		h.ingest.Stop()
	}
	return h.factory.Shutdown()
}
