/*
 * backend/resources/generic/delete_by_gvk.go
 *
 * Stub for the GVK-aware generic delete. Part of the kind-only-objects fix
 * (see docs/plans/kind-only-objects.md, step 5).
 *
 * This file exists ONLY to make the RED regression test in
 * generic_collision_test.go compile. The real implementation will depend on
 * which option from plan step 5 is chosen:
 *
 *  - Option (a), RECOMMENDED: the `backend` caller resolves the GVR via
 *    getGVRForGVKWithDependencies before invoking the generic service. In
 *    that world, DeleteByGVK becomes a simple wrapper that takes an
 *    already-resolved GVR (or is removed in favor of a new
 *    DeleteResourceGVR primitive) and this stub is replaced accordingly.
 *
 *  - Option (b): the GVK resolver is moved to a shared package so both
 *    `backend` and `generic` can call it. Then DeleteByGVK would resolve
 *    the GVR here directly.
 *
 * Either way, once the real implementation lands:
 *   1. Replace the body of DeleteByGVK below with the real delete.
 *   2. Delete this header comment.
 *   3. Confirm TestServiceDeleteByGVKDisambiguatesCollidingDBInstances turns GREEN.
 */

package generic

import (
	"fmt"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// DeleteByGVK is a stub. See the header comment above.
func (s *Service) DeleteByGVK(gvk schema.GroupVersionKind, namespace, name string) error {
	return fmt.Errorf("DeleteByGVK not implemented (stub; see docs/plans/kind-only-objects.md step 5)")
}
