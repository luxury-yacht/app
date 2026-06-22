package informer

import (
	"k8s.io/apimachinery/pkg/api/meta"
)

// stripManagedFields is the projection-at-intake transform (Phase 4 of the v2
// architecture, docs/plans/v2-ground-up-architecture.md §3.1): it discards
// metadata.managedFields before any object lands in an informer cache.
//
// managedFields is server-side-apply bookkeeping — 30-50% of a Pod's bytes — that
// the table / catalog / maintained-store paths never read (verified: no
// StreamRow/Summary projection references it, and `common.LastModifiedTime`, the
// only managedFields consumer, is reached only from detail views, which fetch the
// object FRESH with managedFields retained). Dropping it as each object enters the
// cache shrinks every cached object with zero behavior change — the cheapest, most
// universal slice of the projection-at-intake memory win.
//
// Registered factory-wide via informers.WithTransform, so it runs exactly once per
// object on add/update before the object is stored. client-go unwraps
// cache.DeletedFinalStateUnknown tombstones before invoking the transform; the
// meta.Accessor guard makes any non-accessor input a no-op rather than an error
// (a transform that errors would drop the object from the cache).
func stripManagedFields(obj interface{}) (interface{}, error) {
	accessor, err := meta.Accessor(obj)
	if err != nil {
		return obj, nil
	}
	accessor.SetManagedFields(nil)
	return obj, nil
}
