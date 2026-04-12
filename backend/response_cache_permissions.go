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

// builtinKindGroupResource maps lowercased built-in Kubernetes kinds to
// their canonical (group, resource) pair for SSAR permission checks.
// Mirrors frontend/src/shared/constants/builtinGroupVersions.ts but with
// the plural resource name instead of the version (SSAR keys on
// group/resource, not group/version).
//
// Covers the kinds reachable via objectDetailFetchers (see
// object_detail_provider.go) — these are the only kinds the response
// cache ever holds, so this is the full set of kinds that
// canServeCachedResponse needs to check. Adding a new fetcher entry
// without adding its GroupResource here will cause the permission
// check to silently pass, which is why the lookup is intentionally
// strict (see cachedPermissionAttributes).
var builtinKindGroupResource = map[string]schema.GroupResource{
	// core/v1
	"pod":                   {Group: "", Resource: "pods"},
	"configmap":             {Group: "", Resource: "configmaps"},
	"secret":                {Group: "", Resource: "secrets"},
	"service":               {Group: "", Resource: "services"},
	"serviceaccount":        {Group: "", Resource: "serviceaccounts"},
	"persistentvolumeclaim": {Group: "", Resource: "persistentvolumeclaims"},
	"persistentvolume":      {Group: "", Resource: "persistentvolumes"},
	"namespace":             {Group: "", Resource: "namespaces"},
	"node":                  {Group: "", Resource: "nodes"},
	"resourcequota":         {Group: "", Resource: "resourcequotas"},
	"limitrange":            {Group: "", Resource: "limitranges"},

	// apps/v1
	"deployment":  {Group: "apps", Resource: "deployments"},
	"replicaset":  {Group: "apps", Resource: "replicasets"},
	"daemonset":   {Group: "apps", Resource: "daemonsets"},
	"statefulset": {Group: "apps", Resource: "statefulsets"},

	// batch/v1
	"job":     {Group: "batch", Resource: "jobs"},
	"cronjob": {Group: "batch", Resource: "cronjobs"},

	// networking.k8s.io/v1
	"ingress":       {Group: "networking.k8s.io", Resource: "ingresses"},
	"ingressclass":  {Group: "networking.k8s.io", Resource: "ingressclasses"},
	"networkpolicy": {Group: "networking.k8s.io", Resource: "networkpolicies"},

	// discovery.k8s.io/v1
	"endpointslice": {Group: "discovery.k8s.io", Resource: "endpointslices"},

	// storage.k8s.io/v1
	"storageclass": {Group: "storage.k8s.io", Resource: "storageclasses"},

	// rbac.authorization.k8s.io/v1
	"role":               {Group: "rbac.authorization.k8s.io", Resource: "roles"},
	"rolebinding":        {Group: "rbac.authorization.k8s.io", Resource: "rolebindings"},
	"clusterrole":        {Group: "rbac.authorization.k8s.io", Resource: "clusterroles"},
	"clusterrolebinding": {Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"},

	// autoscaling/v2
	"horizontalpodautoscaler": {Group: "autoscaling", Resource: "horizontalpodautoscalers"},

	// policy/v1
	"poddisruptionbudget": {Group: "policy", Resource: "poddisruptionbudgets"},

	// apiextensions.k8s.io/v1
	"customresourcedefinition": {Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"},

	// admissionregistration.k8s.io/v1
	"mutatingwebhookconfiguration":   {Group: "admissionregistration.k8s.io", Resource: "mutatingwebhookconfigurations"},
	"validatingwebhookconfiguration": {Group: "admissionregistration.k8s.io", Resource: "validatingwebhookconfigurations"},
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
		if subsystem := a.refreshSubsystems[selectionKey]; subsystem != nil && subsystem.RuntimePerms != nil {
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
// static table of built-ins — the response cache only ever stores
// payloads for kinds that objectDetailFetchers knows how to fetch, and
// those are all in this table. A kind missing from the table returns
// ok=false, which canServeCachedResponse treats as "can't check, serve
// the cached response optimistically".
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
	gr, ok := builtinKindGroupResource[normalized]
	if !ok {
		return "", "", "", false
	}
	return gr.Group, gr.Resource, "get", true
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
