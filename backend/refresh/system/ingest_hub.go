/*
 * backend/refresh/system/ingest_hub.go
 *
 * ingestHub is the refresh.FeedHub over the owned reflectors: it starts
 * them with the refresh manager and answers readiness per declared resource
 * from the ingest manager.
 */

package system

import (
	"context"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

type ingestHubManager interface {
	Start(context.Context)
	Stop()
	HasSynced() bool
	StoreFor(schema.GroupVersionResource) *ingest.ProjectingStore
	HasSyncedFor(schema.GroupVersionResource) bool
	ResourceReadinessFor(schema.GroupVersionResource) refresh.ResourceReadiness
}

// ingestHub adapts the ingest manager to refresh.FeedHub.
type ingestHub struct {
	ingest ingestHubManager

	// ownedResources routes canonical permission keys to the owned GVR for both
	// settlement and data readiness. Built once from the kind registry.
	ownedResources map[string]schema.GroupVersionResource
}

// newIngestHub builds the hub. Without an ingest manager, owned keys are
// settled but report their data as unavailable.
func newIngestHub(ingestManager ingestHubManager) *ingestHub {
	resources := make(map[string]schema.GroupVersionResource)
	for _, d := range kindregistry.All {
		resources[permissions.ResourceKey(d.Identity.Group, d.Identity.Resource)] = d.Identity.GVR()
	}
	return &ingestHub{ingest: ingestManager, ownedResources: resources}
}

var _ refresh.FeedHub = (*ingestHub)(nil)

// Start launches the owned reflectors and returns without waiting for them:
// a domain waits on the resources it declares through ResourcesSettled, so one
// slow kind never holds the refresh manager, metrics polling, or unrelated
// domains.
func (h *ingestHub) Start(ctx context.Context) error {
	if h.ingest != nil {
		h.ingest.Start(ctx)
	}
	return nil
}

// HasSynced reports whether every tracked store has settled (synced,
// permission-skipped, or past its sync deadline). Only a domain that declares
// no readiness resources waits on it.
func (h *ingestHub) HasSynced(context.Context) bool {
	return h.ingest != nil && h.ingest.HasSynced()
}

// ResourcesSettled reports whether the store behind each owned key has
// settled. A key with no store (a skipped kind) or no owned reflector has
// nothing to wait for.
func (h *ingestHub) ResourcesSettled(keys []string) bool {
	if h.ingest == nil {
		return true
	}
	for _, key := range keys {
		gvr, owned := h.ownedResources[key]
		if owned && h.ingest.StoreFor(gvr) != nil && !h.ingest.HasSyncedFor(gvr) {
			return false
		}
	}
	return true
}

// ResourceReadiness preserves the per-resource data state that the boolean
// settlement gate collapses for liveness. A key no owned reflector feeds has
// no readiness detail.
func (h *ingestHub) ResourceReadiness(keys []string) map[string]refresh.ResourceReadiness {
	result := make(map[string]refresh.ResourceReadiness, len(keys))
	for _, key := range keys {
		gvr, owned := h.ownedResources[key]
		switch {
		case !owned:
			result[key] = refresh.ResourceReadinessUnknown
		case h.ingest == nil:
			result[key] = refresh.ResourceReadinessUnavailable
		default:
			result[key] = h.ingest.ResourceReadinessFor(gvr)
		}
	}
	return result
}

// Shutdown stops the owned reflectors.
func (h *ingestHub) Shutdown() error {
	if h.ingest != nil {
		h.ingest.Stop()
	}
	return nil
}

// cooledFeedHub is the readiness gate a cooled (Cold-tier serving) subsystem installs on
// its SnapshotService. Cooling stops the manager and the owned reflectors, so the frozen
// stores must no longer wait on the live hub's sync gate (installCooledStores,
// backend/refresh_governor.go). A cooled cluster's data is frozen and resident in its
// mmap-backed maintained stores, so its sync gate must report settled immediately. Its
// lifecycle methods are no-ops: there is nothing to start or shut down.
type cooledFeedHub struct{}

// NewCooledFeedHub returns the always-settled readiness gate for a cooled subsystem.
func NewCooledFeedHub() refresh.FeedHub { return cooledFeedHub{} }

var _ refresh.FeedHub = cooledFeedHub{}

func (cooledFeedHub) Start(context.Context) error    { return nil }
func (cooledFeedHub) HasSynced(context.Context) bool { return true }
func (cooledFeedHub) ResourcesSettled([]string) bool { return true }
func (cooledFeedHub) Shutdown() error                { return nil }
