package informer

import (
	"k8s.io/apimachinery/pkg/api/meta"
)

// StripManagedFields is the projection-at-intake transform (see
// docs/architecture/data-layer.md, "Ingestion"): it discards
// metadata.managedFields before any object lands in an informer cache. Exported so
// every ingestion path — the core/apiext factories here, plus the Gateway-API
// factory and the catalog's dynamic-CRD informers — can install the same transform.
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
func StripManagedFields(obj interface{}) (interface{}, error) {
	accessor, err := meta.Accessor(obj)
	if err != nil {
		return obj, nil
	}
	accessor.SetManagedFields(nil)
	// Also drop the last-applied-configuration annotation: a full JSON copy of the
	// object that `kubectl apply` writes (often KB-scale), in the same class as
	// managedFields — unused by the table/catalog/maintained-store path, retained by
	// detail views (which fetch fresh). Delete the single key in place rather than
	// clearing all annotations, which the table/detail paths DO read.
	if ann := accessor.GetAnnotations(); ann != nil {
		if _, ok := ann[lastAppliedConfigAnnotation]; ok {
			delete(ann, lastAppliedConfigAnnotation)
			accessor.SetAnnotations(ann)
		}
	}
	return obj, nil
}

// lastAppliedConfigAnnotation is the annotation `kubectl apply` writes with a full
// JSON snapshot of the last-applied object.
const lastAppliedConfigAnnotation = "kubectl.kubernetes.io/last-applied-configuration"
