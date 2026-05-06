package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type resourcePermissionCheck struct {
	Group       string
	Version     string
	Kind        string
	Namespace   string
	Name        string
	Verb        string
	Subresource string
}

func (a *App) requireResourcePermission(ctx context.Context, deps common.Dependencies, check resourcePermissionCheck) error {
	gvr, isNamespaced, err := resolvePermissionGVR(ctx, deps, check)
	if err != nil {
		return err
	}
	return a.requireResolvedResourcePermission(ctx, deps, gvr, isNamespaced, check)
}

func (a *App) requireResolvedResourcePermission(
	ctx context.Context,
	deps common.Dependencies,
	gvr schema.GroupVersionResource,
	isNamespaced bool,
	check resourcePermissionCheck,
) error {
	verb := strings.ToLower(strings.TrimSpace(check.Verb))
	if verb == "" {
		return fmt.Errorf("permission verb is required")
	}
	kind := strings.TrimSpace(check.Kind)
	if kind == "" {
		kind = gvr.Resource
	}

	namespace := strings.TrimSpace(check.Namespace)
	if !isNamespaced {
		namespace = ""
	}

	if ctx == nil {
		ctx = deps.Context
	}
	checkCtx, cancel := permissionCheckContext(ctx)
	defer cancel()

	attrs := &authorizationv1.ResourceAttributes{
		Namespace:   namespace,
		Verb:        verb,
		Group:       gvr.Group,
		Resource:    gvr.Resource,
		Subresource: strings.TrimSpace(check.Subresource),
		Name:        strings.TrimSpace(check.Name),
	}
	results, err := capabilities.NewService(capabilities.Dependencies{
		Common:      deps,
		WorkerCount: 1,
	}).Evaluate(checkCtx, []capabilities.ReviewAttributes{{
		ID:         permissionCheckID(kind, attrs),
		Attributes: attrs,
	}})
	if err != nil {
		return fmt.Errorf("permission check failed for %s: %w", permissionDescription(kind, attrs), err)
	}
	if len(results) != 1 {
		return fmt.Errorf("permission check failed for %s: expected one result, got %d", permissionDescription(kind, attrs), len(results))
	}

	result := results[0]
	if result.Error != "" {
		return fmt.Errorf("permission check failed for %s: %s", permissionDescription(kind, attrs), result.Error)
	}
	if result.EvaluationError != "" {
		return fmt.Errorf("permission check failed for %s: %s", permissionDescription(kind, attrs), result.EvaluationError)
	}
	if !result.Allowed {
		if result.DeniedReason != "" {
			return fmt.Errorf("permission denied for %s: %s", permissionDescription(kind, attrs), result.DeniedReason)
		}
		return fmt.Errorf("permission denied for %s", permissionDescription(kind, attrs))
	}
	return nil
}

func (a *App) requireAnyResourcePermission(ctx context.Context, deps common.Dependencies, checks ...resourcePermissionCheck) error {
	var denial error
	for _, check := range checks {
		if err := a.requireResourcePermission(ctx, deps, check); err == nil {
			return nil
		} else {
			denial = err
		}
	}
	if denial != nil {
		return denial
	}
	return fmt.Errorf("permission check requires at least one resource")
}

func resolvePermissionGVR(ctx context.Context, deps common.Dependencies, check resourcePermissionCheck) (schema.GroupVersionResource, bool, error) {
	kind := strings.TrimSpace(check.Kind)
	if kind == "" {
		return schema.GroupVersionResource{}, false, fmt.Errorf("permission kind is required")
	}

	group := strings.TrimSpace(check.Group)
	version := strings.TrimSpace(check.Version)
	if version != "" {
		if resource, ok := lookupBuiltinResourceByGVK(group, version, kind); ok {
			return resource.GVR(), resource.Namespaced, nil
		}
		return common.ResolveGVRForGVK(ctx, deps, schema.GroupVersionKind{
			Group:   group,
			Version: version,
			Kind:    kind,
		})
	}

	if resource, ok := lookupBuiltinResourceByKind(kind); ok {
		return resource.GVR(), resource.Namespaced, nil
	}
	return schema.GroupVersionResource{}, false, fmt.Errorf("apiVersion is required for %s permission checks", kind)
}

func permissionCheckID(kind string, attrs *authorizationv1.ResourceAttributes) string {
	if attrs == nil {
		return strings.ToLower(strings.TrimSpace(kind))
	}
	parts := []string{attrs.Verb, attrs.Group, attrs.Resource}
	if attrs.Subresource != "" {
		parts = append(parts, attrs.Subresource)
	}
	if attrs.Namespace != "" {
		parts = append(parts, attrs.Namespace)
	}
	if attrs.Name != "" {
		parts = append(parts, attrs.Name)
	}
	return strings.Join(parts, ":")
}

func permissionDescription(kind string, attrs *authorizationv1.ResourceAttributes) string {
	if attrs == nil {
		return strings.TrimSpace(kind)
	}
	target := strings.TrimSpace(kind)
	if target == "" {
		target = attrs.Resource
	}
	if attrs.Subresource != "" {
		target += "/" + attrs.Subresource
	}
	if attrs.Name != "" {
		if attrs.Namespace != "" {
			target += " " + attrs.Namespace + "/" + attrs.Name
		} else {
			target += " " + attrs.Name
		}
	} else if attrs.Namespace != "" {
		target += " in namespace " + attrs.Namespace
	}
	return attrs.Verb + " " + target
}
