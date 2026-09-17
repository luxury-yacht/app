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

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type ingestHubFactory interface {
	Start(context.Context) error
	HasSynced(context.Context) bool
	ResourcesSettled([]string) bool
	Shutdown() error
}

type ingestHubManager interface {
	Start(context.Context)
	Stop()
	StoreFor(schema.GroupVersionResource) *ingest.ProjectingStore
	HasSyncedFor(schema.GroupVersionResource) bool
	ResourceReadinessFor(schema.GroupVersionResource) refresh.ResourceReadiness
}

// ingestInformerHub adapts a *informer.Factory plus a *ingest.IngestManager to the
// refresh.InformerHub interface. The factory remains the readiness source for every
// uncut kind; the ingest manager is the readiness source for the cut kinds (whose
// informers the factory no longer registers).
type ingestInformerHub struct {
	factory ingestHubFactory
	ingest  ingestHubManager

	// ingestResources routes canonical permission keys to the owned GVR for both
	// settlement and data readiness. Built once from the registry's IngestOwned facet.
	ingestResources map[string]schema.GroupVersionResource
}

// newIngestInformerHub builds the composite hub. Without an ingest manager,
// ingest-owned keys are settled but report their data as unavailable.
func newIngestInformerHub(factory ingestHubFactory, ingestManager ingestHubManager) *ingestInformerHub {
	resources := make(map[string]schema.GroupVersionResource)
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		resources[permissions.ResourceKey(d.Identity.Group, d.Identity.Resource)] = d.Identity.GVR()
	}
	return &ingestInformerHub{factory: factory, ingest: ingestManager, ingestResources: resources}
}

var _ refresh.InformerHub = (*ingestInformerHub)(nil)

// Start launches ingest-owned reflectors before waiting on the factory sync gate,
// so cut-kind relists warm in parallel with the remaining shared informers. It
// does not wait for every ingest-owned kind: domains that read cut resources
// declare those keys and wait through ResourcesSettled, while global manager
// startup and metrics polling match the factory-scoped startup gate.
func (h *ingestInformerHub) Start(ctx context.Context) error {
	if h.ingest != nil {
		h.ingest.Start(ctx)
	}
	if err := h.factory.Start(ctx); err != nil {
		if h.ingest != nil {
			h.ingest.Stop()
		}
		return err
	}
	return nil
}

// HasSynced reports the global manager readiness gate. Ingest-owned resources are
// intentionally excluded here; callers that need them must use ResourcesSettled
// with concrete resource keys so one slow unrelated cut kind does not hold global
// refresh health or metrics polling.
func (h *ingestInformerHub) HasSynced(ctx context.Context) bool {
	return h.factory.HasSynced(ctx)
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
		if gvr, owned := h.ingestResources[key]; owned {
			if h.ingest != nil && h.ingest.StoreFor(gvr) != nil && !h.ingest.HasSyncedFor(gvr) {
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

// ResourceReadiness preserves the per-resource data state that the boolean
// settlement gate intentionally collapses for liveness. Ingest-owned keys read
// the owned reflector state; all remaining keys delegate to the shared
// informer factory when it exposes the optional reporter contract.
func (h *ingestInformerHub) ResourceReadiness(keys []string) map[string]refresh.ResourceReadiness {
	result := make(map[string]refresh.ResourceReadiness, len(keys))
	factoryKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		result[key] = refresh.ResourceReadinessUnknown
		gvr, owned := h.ingestResources[key]
		if !owned {
			factoryKeys = append(factoryKeys, key)
			continue
		}
		if h.ingest == nil {
			result[key] = refresh.ResourceReadinessUnavailable
			continue
		}
		result[key] = h.ingest.ResourceReadinessFor(gvr)
	}
	if reporter, ok := h.factory.(refresh.ResourceReadinessReporter); ok {
		for key, readiness := range reporter.ResourceReadiness(factoryKeys) {
			result[key] = readiness
		}
	}
	return result
}

// Shutdown stops the ingest reflectors and the factory.
func (h *ingestInformerHub) Shutdown() error {
	if h.ingest != nil {
		h.ingest.Stop()
	}
	return h.factory.Shutdown()
}

// cooledInformerHub is the readiness gate a cooled (Cold-tier serving) subsystem installs on
// its SnapshotService. Cooling shuts the manager + informer factory, after which the live hub
// reports NOT synced (factory.Shutdown clears its synced flag), which would block every cooled
// Build until the sync-deadline. A cooled cluster's data is frozen and resident in its
// mmap-backed maintained stores, so its sync gate must report settled immediately. Its
// lifecycle methods are no-ops: there is nothing to start or shut down.
type cooledInformerHub struct{}

// NewCooledInformerHub returns the always-settled readiness gate for a cooled subsystem.
func NewCooledInformerHub() refresh.InformerHub { return cooledInformerHub{} }

var _ refresh.InformerHub = cooledInformerHub{}

func (cooledInformerHub) Start(context.Context) error    { return nil }
func (cooledInformerHub) HasSynced(context.Context) bool { return true }
func (cooledInformerHub) ResourcesSettled([]string) bool { return true }
func (cooledInformerHub) Shutdown() error                { return nil }
