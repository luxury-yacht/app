/*
 * backend/object_yaml_resolver.go
 *
 * Centralizes GVK-to-GVR resolution policy for YAML read, validate, apply, and
 * reload/merge workflows.
 */

package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type objectYAMLResolverPolicy int

const (
	objectYAMLResolverStrict objectYAMLResolverPolicy = iota
	objectYAMLResolverMutationFallback
)

func resolveObjectYAMLGVR(
	ctx context.Context,
	deps common.Dependencies,
	gvk schema.GroupVersionKind,
	policy objectYAMLResolverPolicy,
) (schema.GroupVersionResource, bool, error) {
	if strings.TrimSpace(gvk.Version) == "" || strings.TrimSpace(gvk.Kind) == "" {
		return schema.GroupVersionResource{}, false, fmt.Errorf("apiVersion and kind are required for GVK resolution")
	}
	if deps.ResourceResolver == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("resource resolver not initialized")
	}
	resolved, ok, err := deps.ResourceResolver.ResolveResourceForGVK(ctx, gvk)
	if err == nil && ok {
		return resolved.GVR(), resolved.Namespaced, nil
	}
	if err == nil {
		err = fmt.Errorf("unable to resolve resource for %s", gvk.String())
	}
	if policy != objectYAMLResolverMutationFallback {
		return schema.GroupVersionResource{}, false, err
	}
	return resolveObjectYAMLGVRWithValidatedFallback(ctx, deps, gvk, err)
}

func resolveObjectYAMLGVRWithValidatedFallback(
	ctx context.Context,
	deps common.Dependencies,
	gvk schema.GroupVersionKind,
	strictErr error,
) (schema.GroupVersionResource, bool, error) {
	fallbackGVR, fallbackNamespaced, fallbackErr := common.DiscoverGVRByKind(ctx, deps, gvk.Kind)
	if fallbackErr != nil {
		return schema.GroupVersionResource{}, false, strictErr
	}
	if gvk.Group == fallbackGVR.Group && gvk.Version == fallbackGVR.Version {
		return fallbackGVR, fallbackNamespaced, nil
	}
	return schema.GroupVersionResource{}, false, strictErr
}
