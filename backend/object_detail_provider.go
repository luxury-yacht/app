/*
 * backend/object_detail_provider.go
 *
 * Fetches and normalizes Kubernetes object details for the object panel.
 * Keeps backend detail reads on full GVK identity so custom resources are not
 * resolved through kind-only fallbacks.
 */

package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/cachekeys"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcecontract"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type objectDetailProvider struct {
	app *App
}

func (a *App) objectDetailProvider() snapshot.ObjectDetailProvider {
	return &objectDetailProvider{app: a}
}

type resolvedObjectDetailContext struct {
	deps         common.Dependencies // Dependencies for resource operations
	selectionKey string              // Selection key for caching and scoping
	scoped       bool                // Indicates if the context is scoped to a specific cluster
}

// objectDetailFetcher maps a kind to dependency-based detail retrievals.
type objectDetailFetcher struct {
	withDeps func(deps common.Dependencies, namespace, name string) (interface{}, string, error)
}

// objectDetailFetchers is generated from the genappbindings binding descriptor
// (see object_detail_fetchers_generated.go); run `go generate ./backend` to refresh.

// detailFetcherVersionPins records the API version a typed detail fetcher
// serves for kinds the built-in contract lists under more than one version. A
// kind absent here must be unique in resourcecontract.BuiltinResources.
var detailFetcherVersionPins = map[string]string{
	"horizontalpodautoscaler": "v2",
}

// objectDetailFetcherGVKs maps each typed detail fetcher to the exact GVK it
// handles. It is fetcher capability metadata, not a resource identity source;
// dynamic resource identity still resolves through the object catalog. The map
// is derived from objectDetailFetchers and resourcecontract.BuiltinResources so
// the GVK identity has a single source of truth.
var objectDetailFetcherGVKs = buildObjectDetailFetcherGVKs()

func buildObjectDetailFetcherGVKs() map[string]schema.GroupVersionKind {
	gvks := make(map[string]schema.GroupVersionKind, len(objectDetailFetchers))
	for kind := range objectDetailFetchers {
		// HelmRelease uses the synthetic helm.sh identity (isHelmReleaseGVK), not a
		// built-in contract entry, so it has no exact-GVK gate.
		if kind == helmReleaseKind {
			continue
		}
		gvks[kind] = resolveDetailFetcherGVK(kind)
	}
	return gvks
}

// resolveDetailFetcherGVK resolves a typed detail fetcher kind to its built-in
// contract GVK, applying detailFetcherVersionPins when the contract lists the
// kind under multiple versions. It panics at package initialization on a
// missing or ambiguous-unpinned kind, mirroring the previous MustBuiltin
// fail-loud contract.
func resolveDetailFetcherGVK(kind string) schema.GroupVersionKind {
	var matches []resourcecontract.BuiltinResource
	for _, resource := range resourcecontract.BuiltinResources {
		if strings.EqualFold(resource.Kind, kind) {
			matches = append(matches, resource)
		}
	}
	pin, pinned := detailFetcherVersionPins[kind]
	switch {
	case len(matches) == 0:
		panic("object detail fetcher kind has no built-in contract entry: " + kind)
	case pinned:
		for _, resource := range matches {
			if resource.Version == pin {
				return resource.GVK()
			}
		}
		panic("object detail fetcher version pin not in contract: " + kind + "/" + pin)
	case len(matches) > 1:
		panic("object detail fetcher kind is ambiguous in contract; add a version pin: " + kind)
	default:
		return matches[0].GVK()
	}
}

// lookupObjectDetailFetcher returns the configured fetcher for the supplied
// complete GVK. Typed fetchers must match the concrete resource they know how
// to retrieve; HelmRelease uses the app's synthetic helm.sh/v3 identity.
func lookupObjectDetailFetcher(gvk schema.GroupVersionKind) (objectDetailFetcher, bool) {
	normalized := strings.ToLower(strings.TrimSpace(gvk.Kind))
	fetcher, ok := objectDetailFetchers[normalized]
	if !ok {
		return objectDetailFetcher{}, false
	}
	if isHelmReleaseGVK(gvk) {
		return fetcher, true
	}
	supported, ok := objectDetailFetcherGVKs[normalized]
	if !ok || !sameGVK(supported, gvk) {
		return objectDetailFetcher{}, false
	}
	return fetcher, true
}

func sameGVK(a, b schema.GroupVersionKind) bool {
	return strings.TrimSpace(a.Group) == strings.TrimSpace(b.Group) &&
		strings.TrimSpace(a.Version) == strings.TrimSpace(b.Version) &&
		strings.EqualFold(strings.TrimSpace(a.Kind), strings.TrimSpace(b.Kind))
}

func isHelmReleaseGVK(gvk schema.GroupVersionKind) bool {
	return strings.TrimSpace(gvk.Group) == "helm.sh" &&
		strings.TrimSpace(gvk.Version) == "v3" &&
		strings.EqualFold(strings.TrimSpace(gvk.Kind), "HelmRelease")
}

// FetchObjectDetails retrieves the details of a Kubernetes object.
func (p *objectDetailProvider) FetchObjectDetails(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (interface{}, string, error) {
	resolved := p.resolveDetailContext(ctx)
	if _, ok := objectDetailFetchers[strings.ToLower(strings.TrimSpace(gvk.Kind))]; !ok {
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}
	if !isHelmReleaseGVK(gvk) && strings.TrimSpace(gvk.Version) == "" {
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}
	if !resolved.scoped {
		return nil, "", fmt.Errorf("cluster scope is required")
	}
	fetcher, ok := lookupObjectDetailFetcher(gvk)
	if !ok {
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}

	cacheKey := objectDetailCacheKeyForGVK(gvk, namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, cacheKey); ok {
			// Avoid serving cached details when permission checks deny access.
			if p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, gvk, namespace, name) {
				return cached, "", nil
			}
			p.app.responseCacheDelete(resolved.selectionKey, cacheKey)
		}
	}
	detail, version, err := fetcher.withDeps(resolved.deps, namespace, name)
	if err == nil && p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, cacheKey, detail)
	}
	return detail, version, err
}

// FetchObjectLastModified returns the relative "last modified" string for an
// object — the most recent spec/metadata managedFields time, formatted like
// Age — or "" when unavailable. It is generic across kinds: it reads the live
// object via the shared strict GVK resolver (which retains managedFields) and
// derives the value with common.FormatLastModified. Results are cached
// alongside details so an open Details tab does not issue a live GET per poll.
func (p *objectDetailProvider) FetchObjectLastModified(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (string, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return "", fmt.Errorf("cluster scope is required")
	}

	cacheKey := objectLastModifiedCacheKey(gvk, namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, cacheKey); ok {
			if value, ok := cached.(string); ok &&
				p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, gvk, namespace, name) {
				return value, nil
			}
			p.app.responseCacheDelete(resolved.selectionKey, cacheKey)
		}
	}

	obj, err := fetchObjectByGVK(ctx, resolved.deps, gvk, namespace, name)
	if err != nil {
		return "", err
	}
	value := common.FormatLastModified(obj)
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, cacheKey, value)
	}
	return value, nil
}

// objectDetailCacheKey matches FetchNamespacedResource cache keys for detail payloads.
func objectDetailCacheKey(kind, namespace, name string) string {
	return cachekeys.Build(strings.ToLower(strings.TrimSpace(kind))+"-detailed", namespace, name)
}

func objectDetailCacheKeyForGVK(gvk schema.GroupVersionKind, namespace, name string) string {
	group := strings.TrimSpace(gvk.Group)
	version := strings.TrimSpace(gvk.Version)
	kind := strings.TrimSpace(gvk.Kind)
	if version == "" {
		return objectDetailCacheKey(kind, namespace, name)
	}
	return cachekeys.Build(strings.ToLower(group+"/"+version+"/"+kind)+"-detailed", namespace, name)
}

// objectLastModifiedCacheKey is distinct from the detail cache key so the
// last-modified string and the detail payload don't overwrite each other.
func objectLastModifiedCacheKey(gvk schema.GroupVersionKind, namespace, name string) string {
	group := strings.TrimSpace(gvk.Group)
	version := strings.TrimSpace(gvk.Version)
	kind := strings.TrimSpace(gvk.Kind)
	if version == "" {
		return cachekeys.Build(strings.ToLower(kind)+"-lastmodified", namespace, name)
	}
	return cachekeys.Build(strings.ToLower(group+"/"+version+"/"+kind)+"-lastmodified", namespace, name)
}

// resolveDetailContext ensures object detail fetches use the cluster scoped to the snapshot request.
func (p *objectDetailProvider) resolveDetailContext(ctx context.Context) resolvedObjectDetailContext {
	if p == nil || p.app == nil {
		return resolvedObjectDetailContext{deps: common.Dependencies{Context: ctx}}
	}

	meta := snapshot.ClusterMetaFromContext(ctx)
	if meta.ClusterID != "" {
		if deps, ok := p.app.resourceDependenciesForClusterID(meta.ClusterID); ok {
			return resolvedObjectDetailContext{
				deps:         deps.CloneWithContext(ctx),
				selectionKey: meta.ClusterID,
				scoped:       true,
			}
		}
	}

	return resolvedObjectDetailContext{
		deps:         common.Dependencies{Context: ctx},
		selectionKey: "",
		scoped:       false,
	}
}

// FetchObjectYAML retrieves the YAML representation of a Kubernetes object.
//
// The caller MUST supply a fully-qualified GVK (group, version, and kind).
// Resolution goes through the cluster's injected resource resolver so
// colliding kinds from different groups disambiguate correctly. The
// kind-only fallback that used to live here was the source of the
// kind-only-objects bug — see the hard-error guard below
func (p *objectDetailProvider) FetchObjectYAML(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (string, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return "", fmt.Errorf("cluster scope is required")
	}

	// All callers MUST supply at least the GVK Version; the kind-only
	// fallback that used to live here was the source of the
	// kind-only-objects bug (two CRDs sharing a Kind landed on whichever
	// the legacy first-match-wins resolver returned). The frontend
	// scope-string producers all emit the GVK form (see
	// frontend/src/modules/object-panel/objectPanelRef.ts
	// and the buildObjectScope helper), so reaching this branch with an
	// empty Version means a producer was missed and we want to fail loud
	// rather than silently pick a CRD.
	if gvk.Version == "" {
		return "", fmt.Errorf(
			"object YAML fetch requires apiVersion (got kind=%q without group/version); "+
				"refresh-domain scope must be in GVK form",
			gvk.Kind,
		)
	}
	return fetchObjectYAMLByGVK(ctx, resolved.deps, gvk, namespace, name)
}

// FetchHelmManifest retrieves the manifest for a Helm release.
func (p *objectDetailProvider) FetchHelmManifest(ctx context.Context, namespace, name string) (string, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return "", 0, fmt.Errorf("cluster scope is required")
	}

	service := helm.NewService(helm.Dependencies{Common: resolved.deps})
	manifestCacheKey := objectDetailCacheKey("HelmManifest", namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, manifestCacheKey); ok {
			if manifest, ok := cached.(string); ok {
				// Avoid serving cached Helm data when permission checks deny access.
				if p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, schema.GroupVersionKind{Group: "helm.sh", Version: "v3", Kind: "HelmManifest"}, namespace, name) {
					revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
					if err != nil {
						return manifest, 0, nil
					}
					return manifest, revision, nil
				}
			}
			p.app.responseCacheDelete(resolved.selectionKey, manifestCacheKey)
		}
	}
	manifest, err := service.ReleaseManifest(namespace, name)
	if err != nil {
		return "", 0, err
	}
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, manifestCacheKey, manifest)
	}
	revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
	if err != nil {
		return manifest, 0, nil
	}
	return manifest, revision, nil
}

// FetchHelmValues retrieves the values for a Helm release.
func (p *objectDetailProvider) FetchHelmValues(ctx context.Context, namespace, name string) (map[string]interface{}, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return nil, 0, fmt.Errorf("cluster scope is required")
	}

	service := helm.NewService(helm.Dependencies{Common: resolved.deps})
	valuesCacheKey := objectDetailCacheKey("HelmValues", namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, valuesCacheKey); ok {
			if values, ok := cached.(map[string]interface{}); ok {
				// Avoid serving cached Helm data when permission checks deny access.
				if p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, schema.GroupVersionKind{Group: "helm.sh", Version: "v3", Kind: "HelmValues"}, namespace, name) {
					revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
					if err != nil {
						return values, 0, nil
					}
					return values, revision, nil
				}
			}
			p.app.responseCacheDelete(resolved.selectionKey, valuesCacheKey)
		}
	}
	values, err := service.ReleaseValues(namespace, name)
	if err != nil {
		return nil, 0, err
	}
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, valuesCacheKey, values)
	}
	revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
	if err != nil {
		return values, 0, nil
	}
	return values, revision, nil
}

// helmReleaseRevisionWithCache reuses cached Helm release details when possible.
func (p *objectDetailProvider) helmReleaseRevisionWithCache(
	resolved resolvedObjectDetailContext,
	service *helm.Service,
	namespace, name string,
) (int, error) {
	detailsCacheKey := objectDetailCacheKey("HelmRelease", namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, detailsCacheKey); ok {
			if details, ok := cached.(*HelmReleaseDetails); ok && details != nil {
				// Avoid serving cached Helm data when permission checks deny access.
				if p.app.canServeCachedResponse(resolved.deps.Context, resolved.deps, resolved.selectionKey, schema.GroupVersionKind{Group: "helm.sh", Version: "v3", Kind: "HelmRelease"}, namespace, name) {
					return details.Revision, nil
				}
			}
			p.app.responseCacheDelete(resolved.selectionKey, detailsCacheKey)
		}
	}

	details, err := service.ReleaseDetails(namespace, name)
	if err != nil || details == nil {
		return 0, err
	}
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, detailsCacheKey, details)
	}
	return details.Revision, nil
}
