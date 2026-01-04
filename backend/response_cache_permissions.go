package backend

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resources/common"
)

const (
	helmManifestKind = "helmmanifest"
	helmValuesKind   = "helmvalues"
	helmReleaseKind  = "helmrelease"
)

// canServeCachedResponse guards cached detail/YAML/helm responses against RBAC changes.
// It returns true when permissions are allowed or cannot be checked, and false on explicit deny.
func (a *App) canServeCachedResponse(
	ctx context.Context,
	deps common.Dependencies,
	selectionKey string,
	kind string,
	namespace string,
	name string,
) bool {
	if a == nil {
		return true
	}
	checker := a.permissionCheckerForSelection(selectionKey, deps)
	if checker == nil {
		return true
	}
	group, resource, verb, ok := cachedPermissionAttributes(deps, selectionKey, kind)
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
		a.responseCacheDelete(selectionKey, objectDetailCacheKey(kind, namespace, name))
		a.responseCacheDelete(selectionKey, objectYAMLCacheKey(kind, namespace, name))
	}
	return decision.Allowed
}

// permissionCheckerForSelection returns the refresh subsystem checker when available,
// falling back to a lightweight checker for the current Kubernetes client.
func (a *App) permissionCheckerForSelection(selectionKey string, deps common.Dependencies) *permissions.Checker {
	if a == nil {
		return nil
	}
	if selectionKey != "" {
		if subsystem := a.refreshSubsystems[selectionKey]; subsystem != nil && subsystem.RuntimePerms != nil {
			return subsystem.RuntimePerms
		}
	}
	if deps.KubernetesClient == nil {
		return nil
	}
	return permissions.NewChecker(deps.KubernetesClient, selectionKey, 0)
}

// cachedPermissionAttributes resolves the resource/verb needed to validate cached responses.
func cachedPermissionAttributes(
	deps common.Dependencies,
	selectionKey string,
	kind string,
) (string, string, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(kind))
	if normalized == "" {
		return "", "", "", false
	}
	if normalized == helmManifestKind || normalized == helmValuesKind || normalized == helmReleaseKind {
		// Helm release data uses the "secret" storage driver, so secrets gate access.
		return "", "secrets", "get", true
	}
	gvr, _, err := getGVRForDependencies(deps, selectionKey, kind)
	if err != nil {
		return "", "", "", false
	}
	return gvr.Group, gvr.Resource, "get", true
}

// permissionCheckContext ensures SSAR calls have a bounded timeout.
func permissionCheckContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, config.PermissionCheckTimeout)
}
