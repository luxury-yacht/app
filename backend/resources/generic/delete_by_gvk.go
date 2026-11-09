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
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// DeleteByGVK removes a Kubernetes resource identified by its
// GroupVersionKind, namespace, and name. The group/version is honored
// strictly: if two CRDs share a Kind, the caller picks which one is
// targeted. A non-empty uid limits the delete to that object. Returns an error
// if the resource cannot be resolved, if the dynamic client is unavailable, or
// if the delete call itself fails.
func (s *Service) DeleteByGVK(ctx context.Context, gvk schema.GroupVersionKind, namespace, name, uid string) error {
	if gvk.Kind == "" {
		return fmt.Errorf("kind is required")
	}
	if gvk.Version == "" {
		return fmt.Errorf("version is required")
	}
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("name is required")
	}

	resolved, err := s.resolveDeleteTarget(ctx, gvk)
	if err != nil {
		return err
	}
	gvr := resolved.GVR()
	isNamespaced := resolved.Namespaced

	dynamicClient, err := s.dynamicClient()
	if err != nil {
		err = s.logError(err, "Failed to create dynamic client")
		return fmt.Errorf("failed to create dynamic client: %w", err)
	}

	deleteOptions := common.DeleteOptionsForUID(uid)
	var deleteErr error
	if isNamespaced {
		if namespace == "" {
			return fmt.Errorf("namespaced resource %s requires a namespace", gvr.String())
		}
		deleteErr = dynamicClient.Resource(gvr).Namespace(namespace).Delete(ctx, name, deleteOptions)
	} else {
		deleteErr = dynamicClient.Resource(gvr).Delete(ctx, name, deleteOptions)
	}

	if deleteErr != nil {
		deleteErr = s.deps.LogDynamicResourceRequestFailure(
			deleteErr,
			fmt.Sprintf("Failed to delete %s %s/%s", gvk.String(), namespace, name),
			common.DynamicResourceRequestSpec{
				Action: "delete", Group: gvr.Group, Version: gvr.Version,
				Resource: gvr.Resource, Namespaced: isNamespaced,
			},
			"GenericResource",
		)
		return fmt.Errorf("failed to delete %s: %w", gvk.String(), deleteErr)
	}

	if namespace == "" {
		s.logInfo(fmt.Sprintf("Deleted %s %s", gvk.String(), name))
	} else {
		s.logInfo(fmt.Sprintf("Deleted %s %s/%s", gvk.String(), namespace, name))
	}
	return nil
}

// resolveDeleteTarget finds the resource for gvk through the injected resolver.
func (s *Service) resolveDeleteTarget(ctx context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, error) {
	if s.deps.ResourceResolver == nil {
		return common.ResolvedResource{}, fmt.Errorf("resource resolver not initialized")
	}
	resolved, ok, err := s.deps.ResourceResolver.ResolveResourceForGVK(ctx, gvk)
	if err == nil && !ok {
		err = fmt.Errorf("unable to resolve resource for %s", gvk.String())
	}
	if err != nil {
		err = s.logError(err, fmt.Sprintf("Failed to resolve GVR for %s", gvk.String()))
		return common.ResolvedResource{}, fmt.Errorf("failed to resolve %s: %w", gvk.String(), err)
	}
	return resolved, nil
}
