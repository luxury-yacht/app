package ingest

import (
	"k8s.io/apimachinery/pkg/api/meta"
)

// stripManagedFields is the projection-at-intake transform (see
// docs/architecture/data-layer.md, "Ingestion"): it discards
// metadata.managedFields before an owned reflector projects the object.
//
// managedFields is server-side-apply bookkeeping — 30-50% of a Pod's bytes — that
// the table / catalog / maintained-store paths never read (verified: no
// StreamRow/Summary projection references it, and `common.LastModifiedTime`, the
// only managedFields consumer, is reached only from detail views, which fetch the
// object FRESH with managedFields retained). Dropping it before projection keeps it
// out of every projected row with zero behavior change.
//
// The projecting store runs it once per object on add/update. The meta.Accessor
// guard makes any non-accessor input a no-op rather than an error.
func stripManagedFields(obj interface{}) (interface{}, error) {
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
