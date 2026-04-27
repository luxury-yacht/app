/*
 * backend/app_permissions.go
 *
 * Wails endpoint for batch permission evaluation. Uses per-namespace SSRR
 * (SelfSubjectRulesReview) caching with SSAR (SelfSubjectAccessReview)
 * fallback for incomplete rules and cluster-scoped resources.
 */

package backend

import (
	"context"
	"fmt"
	"strings"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// resolveGVRForPermissionQuery resolves a permission query to the concrete
// resource used by Kubernetes RBAC. Built-in Kubernetes resources resolve from
// a static table so permission checks do not hit discovery on first load.
// Custom resources route through strict common.ResolveGVRForGVK. Every
// frontend caller now populates PermissionQuery.Group/Version; a missing
// Version here is a programming bug, so we fail loud rather than falling back
// to the retired kind-only resolver, which was first-match-wins across
// colliding CRDs.
func (a *App) resolveGVRForPermissionQuery(ctx context.Context, q capabilities.PermissionQuery) (schema.GroupVersionResource, bool, error) {
	if q.Version == "" {
		return schema.GroupVersionResource{}, false, fmt.Errorf(
			"permission query for kind %q requires apiVersion (group+version); kind-only resolution was retired to fix the kind-only-objects bug",
			q.ResourceKind,
		)
	}
	if resolved, ok := lookupBuiltinResourceByGVK(q.Group, q.Version, q.ResourceKind); ok {
		if _, _, err := a.resolveClusterDependencies(q.ClusterId); err != nil {
			return schema.GroupVersionResource{}, false, err
		}
		return resolved.GVR(), resolved.Namespaced, nil
	}
	deps, _, err := a.resolveClusterDependencies(q.ClusterId)
	if err != nil {
		return schema.GroupVersionResource{}, false, err
	}
	return common.ResolveGVRForGVK(ctx, deps, schema.GroupVersionKind{
		Group:   q.Group,
		Version: q.Version,
		Kind:    q.ResourceKind,
	})
}

// ssarItem tracks a single check that needs SSAR fallback evaluation.
type ssarItem struct {
	resultIdx int
	attrs     capabilities.ReviewAttributes
}

type permissionResolutionResult struct {
	gvr          schema.GroupVersionResource
	isNamespaced bool
	err          error
}

// nsDiagEntry accumulates per-namespace diagnostics during query processing.
type nsDiagEntry struct {
	clusterId         string
	namespace         string
	method            string // "ssrr" or "ssar"
	ssrrIncomplete    bool
	ssrrRuleCount     int
	ssarFallbackCount int
	checkCount        int
}

// QueryPermissions evaluates a batch of permission queries using SSRR caching
// with SSAR fallback. All errors are per-item; the top-level error is always nil.
func (a *App) QueryPermissions(queries []capabilities.PermissionQuery) (*capabilities.QueryPermissionsResponse, error) {
	ctx := a.CtxOrBackground()
	results := make([]capabilities.PermissionResult, len(queries))
	startedAt := time.Now()
	var resolveDuration time.Duration
	var ssrrDuration time.Duration
	var ssarDuration time.Duration

	// Per-request GVK resolution cache. Permission descriptors commonly
	// repeat the same kind across verbs/subresources; resolving once keeps
	// first-load latency tied to unique resources, not descriptor count.
	resolutionCache := make(map[string]permissionResolutionResult)
	// Per-cluster SSAR fallback batches.
	ssarByCluster := make(map[string][]ssarItem)
	// Per-namespace diagnostics keyed by "clusterId|namespace".
	nsDiag := make(map[string]*nsDiagEntry)

	for i, q := range queries {
		// Normalize input fields.
		q.ID = strings.TrimSpace(q.ID)
		q.ClusterId = strings.TrimSpace(q.ClusterId)
		q.Group = strings.TrimSpace(q.Group)
		q.Version = strings.TrimSpace(q.Version)
		q.ResourceKind = strings.TrimSpace(q.ResourceKind)
		q.Verb = strings.ToLower(strings.TrimSpace(q.Verb))
		q.Namespace = strings.TrimSpace(q.Namespace)
		q.Subresource = strings.TrimSpace(q.Subresource)
		q.Name = strings.TrimSpace(q.Name)

		// Write normalized values back for ResultFromQuery.
		queries[i] = q
		results[i] = capabilities.ResultFromQuery(q)

		// Validate required fields.
		if q.ID == "" || q.Verb == "" || q.ResourceKind == "" || q.ClusterId == "" {
			results[i].Source = "error"
			results[i].Error = "missing required field (id, verb, resourceKind, or clusterId)"
			continue
		}

		// Resolve the GVR to get API group, resource name, and scope.
		// Built-in GVKs resolve from a static table. Custom resources route
		// through strict discovery so colliding kinds disambiguate by group/version.
		resolveStart := time.Now()
		gvr, isNamespaced, err := a.resolveGVRForPermissionQueryCached(ctx, q, resolutionCache)
		resolveDuration += time.Since(resolveStart)
		if err != nil {
			results[i].Source = "error"
			results[i].Error = fmt.Sprintf("failed to resolve resource kind %q: %v", q.ResourceKind, err)
			continue
		}

		// Build resource attributes for potential SSAR fallback.
		attrs := &authorizationv1.ResourceAttributes{
			Namespace:   q.Namespace,
			Verb:        q.Verb,
			Group:       gvr.Group,
			Resource:    gvr.Resource,
			Subresource: q.Subresource,
			Name:        q.Name,
		}

		if !isNamespaced {
			// Cluster-scoped resource: route directly to SSAR.
			attrs.Namespace = ""
			ssarByCluster[q.ClusterId] = append(ssarByCluster[q.ClusterId], ssarItem{
				resultIdx: i,
				attrs: capabilities.ReviewAttributes{
					ID:         q.ID,
					Attributes: attrs,
				},
			})
			continue
		}

		// Namespaced resource: try SSRR cache.
		diagKey := q.ClusterId + "|" + q.Namespace
		diag := nsDiag[diagKey]
		if diag == nil {
			diag = &nsDiagEntry{
				clusterId: q.ClusterId,
				namespace: q.Namespace,
			}
			nsDiag[diagKey] = diag
		}
		diag.checkCount++

		cache := a.getOrCreateSSRRCache(q.ClusterId)
		if cache == nil {
			results[i].Source = "error"
			results[i].Error = fmt.Sprintf("failed to create SSRR cache for cluster %s", q.ClusterId)
			continue
		}

		ssrrStart := time.Now()
		status, err := cache.GetRules(ctx, q.Namespace)
		ssrrDuration += time.Since(ssrrStart)
		if err != nil {
			// SSRR fetch failed: fall back to SSAR.
			diag.method = "ssar"
			diag.ssarFallbackCount++
			ssarByCluster[q.ClusterId] = append(ssarByCluster[q.ClusterId], ssarItem{
				resultIdx: i,
				attrs: capabilities.ReviewAttributes{
					ID:         q.ID,
					Attributes: attrs,
				},
			})
			continue
		}

		// SSRR succeeded: record diagnostics.
		if diag.method == "" {
			diag.method = "ssrr"
		}
		diag.ssrrIncomplete = diag.ssrrIncomplete || status.Incomplete
		diag.ssrrRuleCount = len(status.ResourceRules)

		// Try to match the check against cached rules.
		matched := capabilities.MatchRules(status.ResourceRules, gvr.Group, gvr.Resource, q.Verb, q.Subresource, q.Name)
		if matched {
			results[i].Allowed = true
			results[i].Source = "ssrr"
			continue
		}

		if !status.Incomplete {
			// Rules are complete and no match: definitively denied.
			results[i].Allowed = false
			results[i].Source = "denied"
			results[i].Reason = "no matching rule"
			continue
		}

		// Rules incomplete and no match: fall back to SSAR.
		diag.ssarFallbackCount++
		ssarByCluster[q.ClusterId] = append(ssarByCluster[q.ClusterId], ssarItem{
			resultIdx: i,
			attrs: capabilities.ReviewAttributes{
				ID:         q.ID,
				Attributes: attrs,
			},
		})
	}

	// Execute SSAR fallback batches per cluster.
	for clusterID, items := range ssarByCluster {
		ssarStart := time.Now()
		a.executeSSARFallback(ctx, clusterID, items, results)
		ssarDuration += time.Since(ssarStart)
	}

	// Build diagnostics from accumulated data.
	diagnostics := a.buildDiagnostics(nsDiag, ssarByCluster)
	a.logQueryPermissionsBatch(queryPermissionsBatchLog{
		checkCount:       len(queries),
		resolutionCount:  len(resolutionCache),
		namespaceCount:   len(nsDiag),
		ssarCount:        countSSARItems(ssarByCluster),
		totalDuration:    time.Since(startedAt),
		resolveDuration:  resolveDuration,
		ssrrDuration:     ssrrDuration,
		ssarDuration:     ssarDuration,
		diagnosticsCount: len(diagnostics),
	})

	return &capabilities.QueryPermissionsResponse{
		Results:     results,
		Diagnostics: diagnostics,
	}, nil
}

type queryPermissionsBatchLog struct {
	checkCount       int
	resolutionCount  int
	namespaceCount   int
	ssarCount        int
	totalDuration    time.Duration
	resolveDuration  time.Duration
	ssrrDuration     time.Duration
	ssarDuration     time.Duration
	diagnosticsCount int
}

func countSSARItems(itemsByCluster map[string][]ssarItem) int {
	total := 0
	for _, items := range itemsByCluster {
		total += len(items)
	}
	return total
}

func (a *App) logQueryPermissionsBatch(batch queryPermissionsBatchLog) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Debug(
		fmt.Sprintf(
			"QueryPermissions batch checks=%d uniqueGVKs=%d namespaces=%d ssarFallbacks=%d diagnostics=%d total=%s resolve=%s ssrr=%s ssar=%s",
			batch.checkCount,
			batch.resolutionCount,
			batch.namespaceCount,
			batch.ssarCount,
			batch.diagnosticsCount,
			batch.totalDuration,
			batch.resolveDuration,
			batch.ssrrDuration,
			batch.ssarDuration,
		),
		"Permissions",
	)
}

func (a *App) resolveGVRForPermissionQueryCached(
	ctx context.Context,
	q capabilities.PermissionQuery,
	cache map[string]permissionResolutionResult,
) (schema.GroupVersionResource, bool, error) {
	key := permissionResolutionCacheKey(q)
	if cached, ok := cache[key]; ok {
		return cached.gvr, cached.isNamespaced, cached.err
	}
	gvr, isNamespaced, err := a.resolveGVRForPermissionQuery(ctx, q)
	cache[key] = permissionResolutionResult{
		gvr:          gvr,
		isNamespaced: isNamespaced,
		err:          err,
	}
	return gvr, isNamespaced, err
}

func permissionResolutionCacheKey(q capabilities.PermissionQuery) string {
	return strings.Join([]string{
		q.ClusterId,
		q.Group,
		q.Version,
		strings.ToLower(q.ResourceKind),
	}, "|")
}

// executeSSARFallback resolves cluster dependencies, creates a capabilities
// Service, and runs SSAR checks for the given items. Results are written
// directly into the results slice at each item's index.
func (a *App) executeSSARFallback(ctx context.Context, clusterID string, items []ssarItem, results []capabilities.PermissionResult) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		for _, item := range items {
			results[item.resultIdx].Source = "error"
			results[item.resultIdx].Error = fmt.Sprintf("cluster dependency resolution failed: %v", err)
		}
		return
	}

	checks := make([]capabilities.ReviewAttributes, len(items))
	for i, item := range items {
		checks[i] = item.attrs
	}

	svc := capabilities.NewService(capabilities.Dependencies{
		Common: deps,
	})

	evalResults, err := svc.Evaluate(ctx, checks)
	if err != nil {
		// Top-level error means all checks failed.
		for _, item := range items {
			results[item.resultIdx].Source = "error"
			results[item.resultIdx].Error = fmt.Sprintf("SSAR evaluation failed: %v", err)
		}
		return
	}

	for i, eval := range evalResults {
		idx := items[i].resultIdx
		if eval.Error != "" {
			results[idx].Source = "error"
			results[idx].Error = eval.Error
		} else {
			results[idx].Allowed = eval.Allowed
			results[idx].Source = "ssar"
			results[idx].Reason = eval.DeniedReason
		}
	}
}

// buildDiagnostics assembles NamespaceDiagnostics from the per-namespace
// tracking map and cluster-scoped SSAR batch counts.
func (a *App) buildDiagnostics(nsDiag map[string]*nsDiagEntry, ssarByCluster map[string][]ssarItem) []capabilities.NamespaceDiagnostics {
	var diagnostics []capabilities.NamespaceDiagnostics

	// Namespace-scoped diagnostics from nsDiag map.
	for key, diag := range nsDiag {
		diagnostics = append(diagnostics, capabilities.NamespaceDiagnostics{
			Key:               key,
			ClusterId:         diag.clusterId,
			Namespace:         diag.namespace,
			Method:            diag.method,
			SSRRIncomplete:    diag.ssrrIncomplete,
			SSRRRuleCount:     diag.ssrrRuleCount,
			SSARFallbackCount: diag.ssarFallbackCount,
			CheckCount:        diag.checkCount,
		})
	}

	// Cluster-scoped SSAR diagnostics: count items where namespace is empty.
	clusterScopedCounts := make(map[string]int)
	for clusterID, items := range ssarByCluster {
		for _, item := range items {
			if item.attrs.Attributes != nil && item.attrs.Attributes.Namespace == "" {
				clusterScopedCounts[clusterID]++
			}
		}
	}
	for clusterID, count := range clusterScopedCounts {
		key := clusterID + "|__cluster__"
		diagnostics = append(diagnostics, capabilities.NamespaceDiagnostics{
			Key:        key,
			ClusterId:  clusterID,
			Method:     "ssar",
			CheckCount: count,
		})
	}

	return diagnostics
}

// getOrCreateSSRRCache returns the SSRR cache for a cluster, creating it
// lazily if needed. Returns nil if cluster dependencies cannot be resolved.
func (a *App) getOrCreateSSRRCache(clusterID string) *capabilities.SSRRCache {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()

	if a.ssrrCaches == nil {
		a.ssrrCaches = make(map[string]*capabilities.SSRRCache)
	}

	if cache, ok := a.ssrrCaches[clusterID]; ok {
		return cache
	}

	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil
	}

	if deps.KubernetesClient == nil {
		return nil
	}

	fetchFunc := capabilities.NewSSRRFetchFunc(deps.KubernetesClient, config.SSRRFetchTimeout)
	cache := capabilities.NewSSRRCache(clusterID, config.PermissionCacheTTL, config.PermissionCacheStaleGracePeriod, fetchFunc, nil)
	a.ssrrCaches[clusterID] = cache
	return cache
}

// ClearSSRRCache removes the cached SSRR rules for a specific cluster.
func (a *App) ClearSSRRCache(clusterID string) {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()

	if cache, ok := a.ssrrCaches[clusterID]; ok {
		cache.Clear()
		delete(a.ssrrCaches, clusterID)
	}
}

// ClearAllSSRRCaches removes all cached SSRR rules for every cluster.
func (a *App) ClearAllSSRRCaches() {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()

	for _, cache := range a.ssrrCaches {
		cache.Clear()
	}
	a.ssrrCaches = make(map[string]*capabilities.SSRRCache)
}
