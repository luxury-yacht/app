package backend

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	helmManifestKind = "helmmanifest"
	helmValuesKind   = "helmvalues"
	helmReleaseKind  = "helmrelease"
)

// canServeCachedResponse guards cached detail/helm responses against RBAC changes.
// It returns true when permissions are allowed or cannot be checked, and false on explicit deny.
func (g *ResourceGateway) canServeCachedResponse(
	ctx context.Context,
	deps common.Dependencies,
	selectionKey string,
	gvk schema.GroupVersionKind,
	namespace string,
	name string,
) bool {
	if g == nil {
		return true
	}
	checker := g.permissionCheckerForSelection(selectionKey, deps)
	if checker == nil {
		return true
	}
	group, resource, verb, ok := cachedPermissionAttributes(ctx, deps, gvk)
	if !ok {
		return true
	}
	checkCtx, cancel := permissionCheckContext(ctx)
	defer cancel()
	decision, err := checker.Can(checkCtx, group, resource, verb)
	if err != nil {
		// On permission check errors, keep cached responses to avoid blocking offline paths.
		return true
	}
	if !decision.Allowed {
		// objectYAMLCacheKey was retired with the kind-only YAML fetch — the
		// GVK-aware fetch path does not populate the response cache,
		// so there is nothing to evict here for YAML.
		g.responseCacheDelete(selectionKey, objectDetailCacheKey(gvk.Kind, namespace, name))
	}
	return decision.Allowed
}

// permissionCheckerForSelection constructs a request-bound checker from the
// resolved cluster client. Resource cache validation does not reach into refresh
// subsystem state; refresh depends on this gateway only through invalidation.
func (g *ResourceGateway) permissionCheckerForSelection(selectionKey string, deps common.Dependencies) *permissions.Checker {
	if g == nil {
		return nil
	}
	if deps.KubernetesClient == nil {
		return nil
	}
	return permissions.NewChecker(deps.KubernetesClient, selectionKey, 0)
}

// cachedPermissionAttributes resolves the (group, resource, verb) tuple needed
// to validate cached responses. Kubernetes object identity goes through the
// configured resource resolver; Helm release data is synthetic and is gated by
// the Secret storage driver.
func cachedPermissionAttributes(ctx context.Context, deps common.Dependencies, gvk schema.GroupVersionKind) (string, string, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(gvk.Kind))
	if normalized == "" {
		return "", "", "", false
	}
	if normalized == helmManifestKind || normalized == helmValuesKind || normalized == helmReleaseKind {
		// Helm release data uses the "secret" storage driver, so secrets gate access.
		return "", "secrets", "get", true
	}
	if deps.ResourceResolver == nil {
		return "", "", "", false
	}
	resolved, ok, err := deps.ResourceResolver.ResolveResourceForGVK(ctx, gvk)
	if err != nil {
		return "", "", "", false
	}
	if !ok {
		return "", "", "", false
	}
	gvr := resolved.GVR()
	return gvr.Group, gvr.Resource, "get", true
}

// permissionCheckContext ensures SSAR calls have a bounded timeout.
func permissionCheckContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return ctx, func() {
			// The caller owns the existing deadline; no derived context needs cancellation.
		}
	}
	return context.WithTimeout(ctx, config.PermissionCheckTimeout)
}
