/*
 * backend/resources_generic.go
 *
 * App-level generic resource wrappers.
 * - Exposes generic delete handler by resource kind.
 */

package backend

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/resources/generic"
)

// DeleteResourceByGVK removes a Kubernetes object identified by its
// fully-qualified apiVersion + kind. apiVersion must be in the standard
// Kubernetes "group/version" form (or just "version" for core resources
// like "v1"). Unlike DeleteResource, this path resolves the GVR strictly
// through the shared common.ResolveGVRForGVK helper so two CRDs that
// share a Kind don't get conflated.
//
// See docs/plans/kind-only-objects.md step 5.
func (a *App) DeleteResourceByGVK(clusterID, apiVersion, kind, namespace, name string) error {
	gvk := schema.FromAPIVersionAndKind(strings.TrimSpace(apiVersion), strings.TrimSpace(kind))
	if gvk.Kind == "" {
		return fmt.Errorf("kind is required")
	}
	if gvk.Version == "" {
		return fmt.Errorf("apiVersion is required")
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	service := generic.NewService(deps)
	return service.DeleteByGVK(gvk, namespace, name)
}
