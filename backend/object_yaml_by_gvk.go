/*
 * backend/object_yaml_by_gvk.go
 *
 * Stub for the GVK-aware object YAML fetch. Part of the kind-only-objects
 * fix (see docs/plans/kind-only-objects.md, step 3).
 *
 * This file exists ONLY to make the RED regression test in
 * object_yaml_collision_test.go compile. The real implementation will
 * replace this body with a call through getGVRForGVKWithDependencies and
 * the dynamic client, mirroring the existing getObjectYAMLWithDependencies
 * path but with exact-GVK resolution instead of first-match-by-kind.
 *
 * When the real implementation lands:
 *   1. Replace the body of GetObjectYAMLByGVK below with the real fetch.
 *   2. Delete this header comment.
 *   3. Confirm TestGetObjectYAMLByGVKDisambiguatesCollidingDBInstances turns GREEN.
 */

package backend

import "fmt"

// GetObjectYAMLByGVK is a stub. See the header comment above.
func (a *App) GetObjectYAMLByGVK(clusterID, apiVersion, kind, namespace, name string) (string, error) {
	return "", fmt.Errorf("GetObjectYAMLByGVK not implemented (stub; see docs/plans/kind-only-objects.md step 3)")
}
