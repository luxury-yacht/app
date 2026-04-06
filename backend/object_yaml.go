package backend

// This file used to hold the legacy kind-only GVR resolver and its
// discovery cache (getGVR, getGVRForDependencies, gvrCache*,
// gvrCacheKey, loadGVRCached, storeGVRCached, clearGVRCache, and the
// public App.GetObjectYAML Wails method). They were the source of the
// kind-only-objects bug: first-match-wins discovery would silently
// target the wrong CRD whenever two CRDs shared a Kind across different
// API groups.
//
// Everything has been retired. New callers resolve GVKs strictly via
// common.ResolveGVRForGVK and fetch YAML via App.GetObjectYAMLByGVK
// (backend/object_yaml_by_gvk.go). The mutation path uses
// getGVRForGVKWithDependencies (backend/object_yaml_mutation.go), which
// falls back to common.DiscoverGVRByKind only as a partial-discovery
// safety net and validates the result against the requested GVK before
// accepting it.
//
// See docs/plans/kind-only-objects.md for the full migration history.
