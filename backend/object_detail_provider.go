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
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcecontract"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/helm"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

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
	withDeps func(ctx context.Context, deps common.Dependencies, namespace, name string) (snapshot.ObjectDetail, error)
}

// tagObjectDetail tags a fetched DTO with its detail type. Callers name T
// explicitly, so a service that returns another DTO fails to compile instead
// of reaching the frontend under the wrong generated TypeScript type.
func tagObjectDetail[T any](detailType string, detail T, err error) (snapshot.ObjectDetail, error) {
	if err != nil {
		return snapshot.ObjectDetail{}, err
	}
	return snapshot.ObjectDetail{Type: detailType, Details: detail}, nil
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
		// HelmRelease uses the synthetic identity (resourcemodel.HelmReleaseGVK),
		// not a built-in contract entry, so it has no exact-GVK gate.
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
	if resourcemodel.IsHelmReleaseGVK(gvk) {
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

// FetchObjectDetails retrieves the details of a Kubernetes object.
func (p *objectDetailProvider) FetchObjectDetails(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (snapshot.ObjectDetail, error) {
	resolved := p.resolveDetailContext(ctx)
	if resourcekind.FamilyForResource(gvk.Group, gvk.Kind, namespace != "") != "" && gvk.Version != "" {
		detail, err := p.fetchDiscoveredResourceDetails(ctx, resolved, gvk, namespace, name)
		return detail, confirmMissingObject(ctx, resolved, gvk, namespace, name, err)
	}
	if _, ok := objectDetailFetchers[strings.ToLower(strings.TrimSpace(gvk.Kind))]; !ok {
		return snapshot.ObjectDetail{}, snapshot.ErrObjectDetailNotImplemented
	}
	if !resourcemodel.IsHelmReleaseGVK(gvk) && strings.TrimSpace(gvk.Version) == "" {
		return snapshot.ObjectDetail{}, snapshot.ErrObjectDetailNotImplemented
	}
	if !resolved.scoped {
		return snapshot.ObjectDetail{}, fmt.Errorf("cluster scope is required")
	}
	fetcher, ok := lookupObjectDetailFetcher(gvk)
	if !ok {
		return snapshot.ObjectDetail{}, snapshot.ErrObjectDetailNotImplemented
	}

	cacheKey := objectDetailCacheKeyForGVK(gvk, namespace, name)
	if cached, ok := p.cachedObjectDetails(ctx, resolved, gvk, namespace, name, cacheKey); ok {
		return cached, nil
	}
	since := p.cacheGeneration()

	detail, err := fetcher.withDeps(ctx, resolved.deps, namespace, name)
	if err != nil {
		return snapshot.ObjectDetail{}, confirmMissingObject(ctx, resolved, gvk, namespace, name, err)
	}
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, cacheKey, detail, since)
	}
	return detail, nil
}

// confirmMissingObject names the requested object on a NotFound only after an
// uncached read of exactly that object also finds nothing, so a NotFound from
// a related lookup never reports the object itself as deleted.
func confirmMissingObject(
	ctx context.Context,
	resolved resolvedObjectDetailContext,
	gvk schema.GroupVersionKind,
	namespace, name string,
	err error,
) error {
	if resourcemodel.IsHelmReleaseGVK(gvk) {
		return confirmMissingHelmRelease(resolved, namespace, name, err)
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	if _, probeErr := fetchObjectByGVK(ctx, resolved.deps, gvk, namespace, name); !apierrors.IsNotFound(probeErr) {
		return err
	}
	// Requests may spell the kind in any case (the object panel lowercases it);
	// the reference names the canonical identity the panel compares against.
	canonical, ok, resolveErr := resolved.deps.ResourceResolver.ResolveResourceForGVK(ctx, gvk)
	if resolveErr != nil || !ok {
		return err
	}
	return errorstatus.ObjectNotFound(errorstatus.ObjectRef{
		ClusterID: resolved.selectionKey,
		Group:     canonical.Group,
		Version:   canonical.Version,
		Kind:      canonical.Kind,
		Namespace: namespace,
		Name:      name,
	}, err)
}

// confirmMissingHelmRelease names the release only when Helm storage has no
// record of it. Other failures, including API 404s while reaching the cluster,
// say nothing about the release and carry no reference.
func confirmMissingHelmRelease(resolved resolvedObjectDetailContext, namespace, name string, err error) error {
	if !helm.IsReleaseNotFound(err) {
		return err
	}
	ref := helm.ReleaseRef(resolved.selectionKey, namespace, name)
	return errorstatus.ObjectNotFound(errorstatus.ObjectRef{
		ClusterID: ref.ClusterID,
		Group:     ref.Group,
		Version:   ref.Version,
		Kind:      ref.Kind,
		Namespace: ref.Namespace,
		Name:      ref.Name,
	}, err)
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
				p.gateway.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, gvk) {
				return value, nil
			}
			p.gateway.responseCacheDelete(resolved.selectionKey, cacheKey)
		}
	}

	since := p.cacheGeneration()
	obj, err := fetchObjectByGVK(ctx, resolved.deps, gvk, namespace, name)
	if err != nil {
		return snapshot.ObjectHeaderMetadata{}, err
	}
	meta := objectHeaderMetadata(obj)
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, cacheKey, meta, since)
	}
	return meta, nil
}

func objectHeaderMetadata(obj *unstructured.Unstructured) snapshot.ObjectHeaderMetadata {
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
	return meta
}

// objectDetailCacheKey is the kind-only key for Helm content (HelmRelease,
// HelmManifest, HelmValues), which has no GVK detail fetcher.
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
	return fetchHelmContent(p, ctx, "HelmManifest", namespace, name, (*helm.Service).ReleaseManifest)
}

func (p *objectDetailProvider) ResourceResolver(ctx context.Context) common.ResourceResolver {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return nil
	}
	return resolved.deps.ResourceResolver
}

// FetchHelmValues retrieves the chart defaults, merged values, and user
// overrides for a Helm release.
func (p *objectDetailProvider) FetchHelmValues(ctx context.Context, namespace, name string) (helm.HelmReleaseValues, int, error) {
	return fetchHelmContent(p, ctx, "HelmValues", namespace, name, (*helm.Service).ReleaseValues)
}

// helmContent caches Helm content with the revision it was read from, so a
// cache hit never needs another release read to report its revision.
type helmContent[T any] struct {
	content  T
	revision int
}

// fetchHelmContent preserves the shared cache authorization for both Helm
// content domains.
func fetchHelmContent[T any](
	p *objectDetailProvider,
	ctx context.Context,
	kind, namespace, name string,
	fetch func(*helm.Service, string, string) (T, int, error),
) (T, int, error) {
	var zero T
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return zero, 0, fmt.Errorf("cluster scope is required")
	}
	if cached, ok := cachedHelmContent[T](p, ctx, resolved, kind, namespace, name); ok {
		return cached.content, cached.revision, nil
	}
	since := p.cacheGeneration()
	content, revision, err := fetch(helm.NewService(helm.Dependencies{Common: resolved.deps}), namespace, name)
	if err != nil {
		return zero, 0, err
	}
	if p != nil && p.gateway != nil {
		p.gateway.responseCacheStore(resolved.selectionKey, objectDetailCacheKey(kind, namespace, name), helmContent[T]{content: content, revision: revision}, since)
	}
	return content, revision, nil
}

func cachedHelmContent[T any](
	p *objectDetailProvider,
	ctx context.Context,
	resolved resolvedObjectDetailContext,
	kind, namespace, name string,
) (helmContent[T], bool) {
	if p == nil || p.gateway == nil {
		return helmContent[T]{}, false
	}
	cacheKey := objectDetailCacheKey(kind, namespace, name)
	cached, ok := p.gateway.responseCacheLookup(resolved.selectionKey, cacheKey)
	if !ok {
		return helmContent[T]{}, false
	}
	content, typeOK := cached.(helmContent[T])
	allowed := typeOK && p.gateway.canServeCachedResponse(
		ctx,
		resolved.deps,
		resolved.selectionKey,
		resourcemodel.HelmReleaseGVK.GroupVersion().WithKind(kind),
	)
	if !allowed {
		p.gateway.responseCacheDelete(resolved.selectionKey, cacheKey)
		return helmContent[T]{}, false
	}
	return content, true
}

// cacheGeneration is read after the cache lookup, which may evict, and before
// the fetch whose result is cached.
func (p *objectDetailProvider) cacheGeneration() uint64 {
	if p == nil {
		return 0
	}
	return p.gateway.responseCacheGeneration()
}

func (p *objectDetailProvider) cachedObjectDetails(ctx context.Context, resolved resolvedObjectDetailContext, gvk schema.GroupVersionKind, namespace, name, cacheKey string) (snapshot.ObjectDetail, bool) {
	if p != nil && p.gateway != nil {
		if cached, ok := p.gateway.responseCacheLookup(resolved.selectionKey, cacheKey); ok {
			// Avoid serving cached details when permission checks deny access.
			if detail, tagged := cached.(snapshot.ObjectDetail); tagged && p.gateway.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, gvk) {
				return detail, true
			}
			p.gateway.responseCacheDelete(resolved.selectionKey, cacheKey)
		}
	}
	return snapshot.ObjectDetail{}, false
}
