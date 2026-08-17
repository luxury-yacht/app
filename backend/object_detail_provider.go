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
	"time"

	"github.com/luxury-yacht/app/backend/internal/cachekeys"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcecontract"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const helmReleaseAPIGroup = "helm.sh"

type objectDetailProvider struct {
	gateway *ResourceGateway
}

func (g *ResourceGateway) objectDetailProvider() snapshot.ObjectDetailProvider {
	return &objectDetailProvider{gateway: g}
}

type resolvedObjectDetailContext struct {
	deps         common.Dependencies // Dependencies for resource operations
	selectionKey string              // Selection key for caching and scoping
	scoped       bool                // Indicates if the context is scoped to a specific cluster
}

// objectDetailFetcher maps a kind to dependency-based detail retrievals.
type objectDetailFetcher struct {
	withDeps func(ctx context.Context, deps common.Dependencies, namespace, name string) (interface{}, error)
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
	return strings.TrimSpace(gvk.Group) == helmReleaseAPIGroup &&
		strings.TrimSpace(gvk.Version) == "v3" &&
		strings.EqualFold(strings.TrimSpace(gvk.Kind), "HelmRelease")
}

// FetchObjectDetails retrieves the details of a Kubernetes object.
func (p *objectDetailProvider) FetchObjectDetails(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (interface{}, error) {
	resolved := p.resolveDetailContext(ctx)
	if _, ok := objectDetailFetchers[strings.ToLower(strings.TrimSpace(gvk.Kind))]; !ok {
		return nil, snapshot.ErrObjectDetailNotImplemented
	}
	if !isHelmReleaseGVK(gvk) && strings.TrimSpace(gvk.Version) == "" {
		return nil, snapshot.ErrObjectDetailNotImplemented
	}
	if !resolved.scoped {
		return nil, fmt.Errorf("cluster scope is required")
	}
	fetcher, ok := lookupObjectDetailFetcher(gvk)
	if !ok {
		return nil, snapshot.ErrObjectDetailNotImplemented
	}

	cacheKey := objectDetailCacheKeyForGVK(gvk, namespace, name)
	if p != nil && p.gateway != nil {
		if cached, ok := p.gateway.responseCacheLookup(resolved.selectionKey, cacheKey); ok {
			// Avoid serving cached details when permission checks deny access.
			if p.gateway.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, gvk, namespace, name) {
				return cached, nil
			}
			p.gateway.responseCacheDelete(resolved.selectionKey, cacheKey)
		}
	}
	detail, err := fetcher.withDeps(ctx, resolved.deps, namespace, name)
	if err == nil && p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, cacheKey, detail)
	}
	return detail, err
}

// FetchObjectHeaderMetadata returns the object panel's kind-agnostic header
// fields: creation time, last-modified time, resource version, and deletion
// metadata. They derive from a single live-object read via the
// shared strict GVK resolver (which retains managedFields), so Age works for
// every kind — including custom resources that have no typed detail panel.
// Optional fields are omitted when unavailable. Results are cached alongside
// details so an open Details tab does not issue a live GET per poll.
func (p *objectDetailProvider) FetchObjectHeaderMetadata(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (snapshot.ObjectHeaderMetadata, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return snapshot.ObjectHeaderMetadata{}, fmt.Errorf("cluster scope is required")
	}

	cacheKey := objectHeaderMetadataCacheKey(gvk, namespace, name)
	if p != nil && p.gateway != nil {
		if cached, ok := p.gateway.responseCacheLookup(resolved.selectionKey, cacheKey); ok {
			if value, ok := cached.(snapshot.ObjectHeaderMetadata); ok &&
				p.gateway.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, gvk, namespace, name) {
				return value, nil
			}
			p.gateway.responseCacheDelete(resolved.selectionKey, cacheKey)
		}
	}

	obj, err := fetchObjectByGVK(ctx, resolved.deps, gvk, namespace, name)
	if err != nil {
		return snapshot.ObjectHeaderMetadata{}, err
	}
	meta := snapshot.ObjectHeaderMetadata{
		LastModified:    common.FormatLastModified(obj),
		ResourceVersion: obj.GetResourceVersion(),
	}
	if created := obj.GetCreationTimestamp(); !created.IsZero() {
		meta.CreationTimestamp = created.UTC().Format(time.RFC3339)
	}
	if deleted := obj.GetDeletionTimestamp(); deleted != nil {
		meta.Deletion = &snapshot.ObjectDeletionMetadata{
			DeletionTimestamp: deleted.UTC().Format(time.RFC3339),
			Finalizers:        append([]string(nil), obj.GetFinalizers()...),
		}
	}
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, cacheKey, meta)
	}
	return meta, nil
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

// objectHeaderMetadataCacheKey is distinct from the detail cache key so the
// header metadata (creation + last-modified) and the detail payload don't
// overwrite each other.
func objectHeaderMetadataCacheKey(gvk schema.GroupVersionKind, namespace, name string) string {
	group := strings.TrimSpace(gvk.Group)
	version := strings.TrimSpace(gvk.Version)
	kind := strings.TrimSpace(gvk.Kind)
	if version == "" {
		return cachekeys.Build(strings.ToLower(kind)+"-headermeta", namespace, name)
	}
	return cachekeys.Build(strings.ToLower(group+"/"+version+"/"+kind)+"-headermeta", namespace, name)
}

// resolveDetailContext ensures object detail fetches use the cluster scoped to the snapshot request.
func (p *objectDetailProvider) resolveDetailContext(ctx context.Context) resolvedObjectDetailContext {
	if p == nil || p.gateway == nil {
		return resolvedObjectDetailContext{}
	}

	meta := snapshot.ClusterMetaFromContext(ctx)
	if meta.ClusterID != "" {
		if deps, ok := p.gateway.resourceDependenciesForClusterID(meta.ClusterID); ok {
			return resolvedObjectDetailContext{
				deps:         deps.WithOperationContext(ctx),
				selectionKey: meta.ClusterID,
				scoped:       true,
			}
		}
	}

	return resolvedObjectDetailContext{
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
	if manifest, revision, ok := cachedHelmDetail[string](p, ctx, resolved, service, "HelmManifest", namespace, name); ok {
		return manifest, revision, nil
	}
	manifest, err := service.ReleaseManifest(namespace, name)
	if err != nil {
		return "", 0, err
	}
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, manifestCacheKey, manifest)
	}
	return manifest, helmRevisionOrZero(ctx, p, resolved, service, namespace, name), nil
}

func (p *objectDetailProvider) ResourceResolver(ctx context.Context) common.ResourceResolver {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return nil
	}
	return resolved.deps.ResourceResolver
}

// FetchHelmValues retrieves the values for a Helm release.
func (p *objectDetailProvider) FetchHelmValues(ctx context.Context, namespace, name string) (map[string]interface{}, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return nil, 0, fmt.Errorf("cluster scope is required")
	}

	service := helm.NewService(helm.Dependencies{Common: resolved.deps})
	valuesCacheKey := objectDetailCacheKey("HelmValues", namespace, name)
	if values, revision, ok := cachedHelmDetail[map[string]interface{}](p, ctx, resolved, service, "HelmValues", namespace, name); ok {
		return values, revision, nil
	}
	values, err := service.ReleaseValues(namespace, name)
	if err != nil {
		return nil, 0, err
	}
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, valuesCacheKey, values)
	}
	return values, helmRevisionOrZero(ctx, p, resolved, service, namespace, name), nil
}

func cachedHelmDetail[T any](
	p *objectDetailProvider,
	ctx context.Context,
	resolved resolvedObjectDetailContext,
	service *helm.Service,
	kind, namespace, name string,
) (T, int, bool) {
	var zero T
	if p == nil || p.gateway == nil {
		return zero, 0, false
	}
	cacheKey := objectDetailCacheKey(kind, namespace, name)
	cached, ok := p.gateway.responseCacheLookup(resolved.selectionKey, cacheKey)
	if !ok {
		return zero, 0, false
	}
	detail, typeOK := cached.(T)
	allowed := typeOK && p.gateway.canServeCachedResponse(
		ctx,
		resolved.deps,
		resolved.selectionKey,
		schema.GroupVersionKind{Group: helmReleaseAPIGroup, Version: "v3", Kind: kind},
		namespace,
		name,
	)
	if !allowed {
		p.gateway.responseCacheDelete(resolved.selectionKey, cacheKey)
		return zero, 0, false
	}
	return detail, helmRevisionOrZero(ctx, p, resolved, service, namespace, name), true
}

func helmRevisionOrZero(
	ctx context.Context,
	p *objectDetailProvider,
	resolved resolvedObjectDetailContext,
	service *helm.Service,
	namespace, name string,
) int {
	revision, err := p.helmReleaseRevisionWithCache(ctx, resolved, service, namespace, name)
	if err != nil {
		return 0
	}
	return revision
}

// helmReleaseRevisionWithCache reuses cached Helm release details when possible.
func (p *objectDetailProvider) helmReleaseRevisionWithCache(
	ctx context.Context,
	resolved resolvedObjectDetailContext,
	service *helm.Service,
	namespace, name string,
) (int, error) {
	detailsCacheKey := objectDetailCacheKey("HelmRelease", namespace, name)
	if revision, ok := p.cachedHelmReleaseRevision(ctx, resolved, detailsCacheKey, namespace, name); ok {
		return revision, nil
	}

	details, err := service.ReleaseDetails(ctx, namespace, name)
	if err != nil || details == nil {
		return 0, err
	}
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, detailsCacheKey, details)
	}
	return details.Revision, nil
}

func (p *objectDetailProvider) cachedHelmReleaseRevision(
	ctx context.Context,
	resolved resolvedObjectDetailContext,
	detailsCacheKey, namespace, name string,
) (int, bool) {
	if p == nil || p.gateway == nil {
		return 0, false
	}
	cached, ok := p.gateway.responseCacheLookup(resolved.selectionKey, detailsCacheKey)
	if !ok {
		return 0, false
	}
	details, ok := cached.(*HelmReleaseDetails)
	if ok && details != nil && p.gateway.canServeCachedResponse(
		ctx,
		resolved.deps,
		resolved.selectionKey,
		schema.GroupVersionKind{Group: helmReleaseAPIGroup, Version: "v3", Kind: "HelmRelease"},
		namespace,
		name,
	) {
		return details.Revision, true
	}
	p.gateway.responseCacheDelete(resolved.selectionKey, detailsCacheKey)
	return 0, false
}
