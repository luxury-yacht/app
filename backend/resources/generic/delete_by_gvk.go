/*
 * backend/resources/generic/delete_by_gvk.go
 *
 * GVK-aware generic delete. Part of the kind-only-objects fix
 *
 * Unlike Service.Delete, which accepts a bare kind string and uses a
 * first-match-wins discovery walk to resolve the GVR, DeleteByGVK takes a
 * fully-qualified GroupVersionKind and resolves strictly through the
 * injected common.ResourceResolver. That keeps resource identity behind
 * one object-catalog-backed resolver without a package cycle.
 */

package generic

import (
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// DeleteByGVK removes a Kubernetes resource identified by its
// GroupVersionKind, namespace, and name. The group/version is honored
// strictly: if two CRDs share a Kind, the caller picks which one is
// targeted. Returns an error if the resource cannot be resolved, if the
// dynamic client is unavailable, or if the delete call itself fails.
func (s *Service) DeleteByGVK(gvk schema.GroupVersionKind, namespace, name string) error {
	if gvk.Kind == "" {
		return fmt.Errorf("kind is required")
	}
	if gvk.Version == "" {
		return fmt.Errorf("version is required")
	}
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("name is required")
	}

	if s.deps.ResourceResolver == nil {
		return fmt.Errorf("resource resolver not initialized")
	}
	resolved, ok, err := s.deps.ResourceResolver.ResolveResourceForGVK(s.context(), gvk)
	if err != nil {
		s.logError(fmt.Sprintf("Failed to resolve GVR for %s: %v", gvk.String(), err))
		return fmt.Errorf("failed to resolve %s: %w", gvk.String(), err)
	}
	if !ok {
		err := fmt.Errorf("unable to resolve resource for %s", gvk.String())
		s.logError(fmt.Sprintf("Failed to resolve GVR for %s: %v", gvk.String(), err))
		return fmt.Errorf("failed to resolve %s: %w", gvk.String(), err)
	}
	gvr := resolved.GVR()
	isNamespaced := resolved.Namespaced

	dynamicClient, err := s.dynamicClient()
	if err != nil {
		s.logError(fmt.Sprintf("Failed to create dynamic client: %v", err))
		return fmt.Errorf("failed to create dynamic client: %w", err)
	}

	ctx := s.context()

	var deleteErr error
	if isNamespaced {
		if namespace == "" {
			return fmt.Errorf("namespaced resource %s requires a namespace", gvr.String())
		}
		deleteErr = dynamicClient.Resource(gvr).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	} else {
		deleteErr = dynamicClient.Resource(gvr).Delete(ctx, name, metav1.DeleteOptions{})
	}

	if deleteErr != nil {
		s.logError(fmt.Sprintf("Failed to delete %s %s/%s: %v", gvk.String(), namespace, name, deleteErr))
		return fmt.Errorf("failed to delete %s: %w", gvk.String(), deleteErr)
	}

	if namespace == "" {
		s.logInfo(fmt.Sprintf("Deleted %s %s", gvk.String(), name))
	} else {
		s.logInfo(fmt.Sprintf("Deleted %s %s/%s", gvk.String(), namespace, name))
	}
	return nil
}
