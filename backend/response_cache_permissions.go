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

// builtinDetailCachePermissionKinds is response-cache policy, not resource
// identity. It is intentionally narrower than builtinResourceCatalog because
// cached detail reads are checked only for built-in kinds whose cached payloads
// are guarded by a simple Kubernetes "get" permission check.
var builtinDetailCachePermissionKinds = map[string]struct{}{
	"pod":                            {},
	"configmap":                      {},
	"secret":                         {},
	"service":                        {},
	"serviceaccount":                 {},
	"persistentvolumeclaim":          {},
	"persistentvolume":               {},
	"namespace":                      {},
	"node":                           {},
	"resourcequota":                  {},
	"limitrange":                     {},
	"deployment":                     {},
	"replicaset":                     {},
	"daemonset":                      {},
	"statefulset":                    {},
	"job":                            {},
	"cronjob":                        {},
	"ingress":                        {},
	"ingressclass":                   {},
	"networkpolicy":                  {},
	"endpointslice":                  {},
	"gateway":                        {},
	"httproute":                      {},
	"grpcroute":                      {},
	"tlsroute":                       {},
	"listenerset":                    {},
	"backendtlspolicy":               {},
	"referencegrant":                 {},
	"gatewayclass":                   {},
	"storageclass":                   {},
	"role":                           {},
	"rolebinding":                    {},
	"clusterrole":                    {},
	"clusterrolebinding":             {},
	"horizontalpodautoscaler":        {},
	"poddisruptionbudget":            {},
	"customresourcedefinition":       {},
	"mutatingwebhookconfiguration":   {},
	"validatingwebhookconfiguration": {},
}

// canServeCachedResponse guards cached detail/helm responses against RBAC changes.
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
	group, resource, verb, ok := cachedPermissionAttributes(kind)
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
		// objectYAMLCacheKey was retired with App.GetObjectYAML — the
		// GVK-aware fetch path does not populate the response cache,
		// so there is nothing to evict here for YAML.
		a.responseCacheDelete(selectionKey, objectDetailCacheKey(kind, namespace, name))
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
		if subsystem := a.getRefreshSubsystem(selectionKey); subsystem != nil && subsystem.RuntimePerms != nil {
			return subsystem.RuntimePerms
		}
	}
	if deps.KubernetesClient == nil {
		return nil
	}
	return permissions.NewChecker(deps.KubernetesClient, selectionKey, 0)
}

// cachedPermissionAttributes resolves the (group, resource, verb) tuple
// needed to validate cached responses. Looks up the kind against a
// central built-in resource catalog. The response cache only ever stores
// payloads for kinds that objectDetailFetchers knows how to fetch, so this
// function first checks the response-cache allowlist. A kind missing from
// the allowlist or catalog returns ok=false, which canServeCachedResponse
// treats as "can't check, serve the cached response optimistically".
//
// This used to route through the legacy getGVRForDependencies resolver
// (first-match-wins discovery) which was the source of the
// kind-only-objects bug. The static table is strictly bounded to
// built-ins that never collide across groups.
func cachedPermissionAttributes(kind string) (string, string, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(kind))
	if normalized == "" {
		return "", "", "", false
	}
	if normalized == helmManifestKind || normalized == helmValuesKind || normalized == helmReleaseKind {
		// Helm release data uses the "secret" storage driver, so secrets gate access.
		return "", "secrets", "get", true
	}
	if !isBuiltinDetailCachePermissionKind(normalized) {
		return "", "", "", false
	}
	info, ok := lookupBuiltinResourceByKind(normalized)
	if !ok {
		return "", "", "", false
	}
	gr := info.GR()
	return gr.Group, gr.Resource, "get", true
}

func isBuiltinDetailCachePermissionKind(kind string) bool {
	normalized := strings.ToLower(strings.TrimSpace(kind))
	if normalized == "" {
		return false
	}
	_, ok := builtinDetailCachePermissionKinds[normalized]
	return ok
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
