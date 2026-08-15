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
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
)

// resolveGVRForPermissionQuery resolves a permission query to the concrete
// resource used by Kubernetes RBAC. Resolution goes through the cluster's
// object-catalog-backed resolver. Every frontend caller now populates
// PermissionQuery.Group/Version; a missing Version here is a programming bug,
// so we fail loud rather than falling back to the retired kind-only resolver,
// which was first-match-wins across colliding CRDs.
func (a *App) resolveGVRForPermissionQuery(ctx context.Context, q capabilities.PermissionQuery) (schema.GroupVersionResource, bool, error) {
	if q.Version == "" {
		return schema.GroupVersionResource{}, false, fmt.Errorf(
			"permission query for kind %q requires apiVersion (group+version); kind-only resolution was retired to fix the kind-only-objects bug",
			q.ResourceKind,
		)
	}
	deps, _, err := a.resolveClusterDependencies(q.ClusterId)
	if err != nil {
		return schema.GroupVersionResource{}, false, err
	}
	if deps.ResourceResolver == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("resource resolver not initialized")
	}
	resolved, ok, err := deps.ResourceResolver.ResolveResourceForGVK(ctx, schema.GroupVersionKind{
		Group:   q.Group,
		Version: q.Version,
		Kind:    q.ResourceKind,
	})
	if err != nil {
		return schema.GroupVersionResource{}, false, err
	}
	if !ok {
		return schema.GroupVersionResource{}, false, fmt.Errorf("unable to resolve resource for %s/%s", q.Version, q.ResourceKind)
	}
	return resolved.GVR(), resolved.Namespaced, nil
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

type preparedPermissionQuery struct {
	resultIdx     int
	query         capabilities.PermissionQuery
	gvr           schema.GroupVersionResource
	isNamespaced  bool
	attributes    *authorizationv1.ResourceAttributes
	diagnosticKey string
}

type ssrrNamespaceKey struct {
	clusterID string
	namespace string
}

type ssrrNamespaceFetch struct {
	index int
	key   ssrrNamespaceKey
}

type ssrrNamespaceResult struct {
	status *authorizationv1.SubjectRulesReviewStatus
	err    error
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

type permissionQueryBatch struct {
	results          []capabilities.PermissionResult
	resolutionCache  map[string]permissionResolutionResult
	preparedQueries  []preparedPermissionQuery
	ssrrFetchesByKey map[string]ssrrNamespaceKey
	ssarByCluster    map[string][]ssarItem
	nsDiag           map[string]*nsDiagEntry
	resolveDuration  time.Duration
	ssrrDuration     time.Duration
	ssarDuration     time.Duration
}

// QueryPermissions evaluates a batch of permission queries using SSRR caching
// with SSAR fallback. All errors are per-item; the top-level error is always nil.
func (a *App) QueryPermissions(queries []capabilities.PermissionQuery) (*capabilities.QueryPermissionsResponse, error) {
	ctx := a.CtxOrBackground()
	startedAt := time.Now()
	batch := newPermissionQueryBatch(len(queries))
	a.preparePermissionQueries(ctx, queries, batch)

	ssrrStart := time.Now()
	ssrrResults := a.fetchSSRRRulesForNamespaces(ctx, batch.ssrrFetchesByKey)
	batch.ssrrDuration = time.Since(ssrrStart)
	a.evaluatePermissionQueries(batch, ssrrResults)
	a.executePermissionSSARBatches(ctx, batch)

	diagnostics := a.buildDiagnostics(batch.nsDiag, batch.ssarByCluster)
	a.logQueryPermissionsBatch(queryPermissionsBatchLog{
		checkCount:       len(queries),
		resolutionCount:  len(batch.resolutionCache),
		namespaceCount:   len(batch.nsDiag),
		ssarCount:        countSSARItems(batch.ssarByCluster),
		totalDuration:    time.Since(startedAt),
		resolveDuration:  batch.resolveDuration,
		ssrrDuration:     batch.ssrrDuration,
		ssarDuration:     batch.ssarDuration,
		diagnosticsCount: len(diagnostics),
	})

	return &capabilities.QueryPermissionsResponse{
		Results:     batch.results,
		Diagnostics: diagnostics,
	}, nil
}

func newPermissionQueryBatch(queryCount int) *permissionQueryBatch {
	return &permissionQueryBatch{
		results:          make([]capabilities.PermissionResult, queryCount),
		resolutionCache:  make(map[string]permissionResolutionResult),
		preparedQueries:  make([]preparedPermissionQuery, 0, queryCount),
		ssrrFetchesByKey: make(map[string]ssrrNamespaceKey),
		ssarByCluster:    make(map[string][]ssarItem),
		nsDiag:           make(map[string]*nsDiagEntry),
	}
}

func normalizePermissionQuery(q capabilities.PermissionQuery) capabilities.PermissionQuery {
	q.ID = strings.TrimSpace(q.ID)
	q.ClusterId = strings.TrimSpace(q.ClusterId)
	q.Group = strings.TrimSpace(q.Group)
	q.Version = strings.TrimSpace(q.Version)
	q.ResourceKind = strings.TrimSpace(q.ResourceKind)
	q.Verb = strings.ToLower(strings.TrimSpace(q.Verb))
	q.Namespace = strings.TrimSpace(q.Namespace)
	q.Subresource = strings.TrimSpace(q.Subresource)
	q.Name = strings.TrimSpace(q.Name)
	return q
}

func (a *App) preparePermissionQueries(ctx context.Context, queries []capabilities.PermissionQuery, batch *permissionQueryBatch) {
	for index, raw := range queries {
		query := normalizePermissionQuery(raw)
		queries[index] = query
		batch.results[index] = capabilities.ResultFromQuery(query)
		prepared, duration, err := a.preparePermissionQuery(ctx, query, index, batch.resolutionCache)
		batch.resolveDuration += duration
		if err != nil {
			batch.results[index].Source = "error"
			batch.results[index].Error = err.Error()
			continue
		}
		batch.registerPreparedQuery(prepared)
	}
}

func (a *App) preparePermissionQuery(
	ctx context.Context,
	query capabilities.PermissionQuery,
	resultIndex int,
	resolutionCache map[string]permissionResolutionResult,
) (preparedPermissionQuery, time.Duration, error) {
	if query.ID == "" || query.Verb == "" || query.ResourceKind == "" || query.ClusterId == "" {
		return preparedPermissionQuery{}, 0, fmt.Errorf("missing required field (id, verb, resourceKind, or clusterId)")
	}
	startedAt := time.Now()
	gvr, isNamespaced, err := a.resolveGVRForPermissionQueryCached(ctx, query, resolutionCache)
	duration := time.Since(startedAt)
	if err != nil {
		return preparedPermissionQuery{}, duration, fmt.Errorf("failed to resolve resource kind %q: %w", query.ResourceKind, err)
	}
	return preparedPermissionQuery{
		resultIdx: resultIndex, query: query, gvr: gvr, isNamespaced: isNamespaced,
		attributes: &authorizationv1.ResourceAttributes{
			Namespace: query.Namespace, Verb: query.Verb, Group: gvr.Group, Resource: gvr.Resource,
			Subresource: query.Subresource, Name: query.Name,
		},
	}, duration, nil
}

func (b *permissionQueryBatch) registerPreparedQuery(prepared preparedPermissionQuery) {
	query := prepared.query
	if prepared.isNamespaced && query.Namespace != "" {
		diagnosticKey := query.ClusterId + "|" + query.Namespace
		prepared.diagnosticKey = diagnosticKey
		diagnostic := b.nsDiag[diagnosticKey]
		if diagnostic == nil {
			diagnostic = &nsDiagEntry{clusterId: query.ClusterId, namespace: query.Namespace}
			b.nsDiag[diagnosticKey] = diagnostic
		}
		diagnostic.checkCount++
		b.ssrrFetchesByKey[diagnosticKey] = ssrrNamespaceKey{clusterID: query.ClusterId, namespace: query.Namespace}
	}
	b.preparedQueries = append(b.preparedQueries, prepared)
}

func (a *App) evaluatePermissionQueries(batch *permissionQueryBatch, ssrrResults map[string]ssrrNamespaceResult) {
	for _, prepared := range batch.preparedQueries {
		a.evaluatePermissionQuery(batch, prepared, ssrrResults)
	}
}

func (a *App) evaluatePermissionQuery(
	batch *permissionQueryBatch,
	prepared preparedPermissionQuery,
	ssrrResults map[string]ssrrNamespaceResult,
) {
	query := prepared.query
	if !prepared.isNamespaced || query.Namespace == "" {
		prepared.attributes.Namespace = ""
		batch.enqueueSSAR(prepared)
		return
	}

	diagnostic := batch.nsDiag[prepared.diagnosticKey]
	ssrrResult, ok := ssrrResults[prepared.diagnosticKey]
	if !ok {
		ssrrResult.err = fmt.Errorf("SSRR result missing for cluster %s namespace %s", query.ClusterId, query.Namespace)
	}
	if ssrrResult.err != nil {
		diagnostic.method = "ssar"
		diagnostic.ssarFallbackCount++
		batch.enqueueSSAR(prepared)
		return
	}

	status := ssrrResult.status
	recordSSRRDiagnostic(diagnostic, status)
	if capabilities.MatchRules(status.ResourceRules, prepared.gvr.Group, prepared.gvr.Resource, query.Verb, query.Subresource, query.Name) {
		batch.results[prepared.resultIdx].Allowed = true
		batch.results[prepared.resultIdx].Source = "ssrr"
		return
	}
	if !status.Incomplete {
		batch.results[prepared.resultIdx].Allowed = false
		batch.results[prepared.resultIdx].Source = "denied"
		batch.results[prepared.resultIdx].Reason = "no matching rule"
		return
	}
	diagnostic.ssarFallbackCount++
	batch.enqueueSSAR(prepared)
}

func recordSSRRDiagnostic(diagnostic *nsDiagEntry, status *authorizationv1.SubjectRulesReviewStatus) {
	if diagnostic.method == "" {
		diagnostic.method = "ssrr"
	}
	diagnostic.ssrrIncomplete = diagnostic.ssrrIncomplete || status.Incomplete
	diagnostic.ssrrRuleCount = len(status.ResourceRules)
}

func (b *permissionQueryBatch) enqueueSSAR(prepared preparedPermissionQuery) {
	query := prepared.query
	b.ssarByCluster[query.ClusterId] = append(b.ssarByCluster[query.ClusterId], ssarItem{
		resultIdx: prepared.resultIdx,
		attrs:     capabilities.ReviewAttributes{ID: query.ID, Attributes: prepared.attributes},
	})
}

func (a *App) executePermissionSSARBatches(ctx context.Context, batch *permissionQueryBatch) {
	for clusterID, items := range batch.ssarByCluster {
		startedAt := time.Now()
		a.executeSSARFallback(ctx, clusterID, items, batch.results)
		batch.ssarDuration += time.Since(startedAt)
	}
}

func (a *App) fetchSSRRRulesForNamespaces(
	ctx context.Context,
	keysByDiagnostic map[string]ssrrNamespaceKey,
) map[string]ssrrNamespaceResult {
	if len(keysByDiagnostic) == 0 {
		return nil
	}

	fetches := make([]ssrrNamespaceFetch, 0, len(keysByDiagnostic))
	diagnosticKeys := make([]string, 0, len(keysByDiagnostic))
	for diagnosticKey, key := range keysByDiagnostic {
		diagnosticKeys = append(diagnosticKeys, diagnosticKey)
		fetches = append(fetches, ssrrNamespaceFetch{
			index: len(diagnosticKeys) - 1,
			key:   key,
		})
	}

	results := make([]ssrrNamespaceResult, len(fetches))
	_ = parallel.ForEach(ctx, fetches, a.permissionSSRRFetchConcurrency(), func(ctx context.Context, fetch ssrrNamespaceFetch) error {
		cache := a.getOrCreateSSRRCache(fetch.key.clusterID)
		if cache == nil {
			results[fetch.index] = ssrrNamespaceResult{
				err: fmt.Errorf("failed to create SSRR cache for cluster %s", fetch.key.clusterID),
			}
			return nil
		}
		status, err := cache.GetRules(ctx, fetch.key.namespace)
		if err == nil && status == nil {
			err = fmt.Errorf("SSRR returned no status for cluster %s namespace %s", fetch.key.clusterID, fetch.key.namespace)
		}
		results[fetch.index] = ssrrNamespaceResult{
			status: status,
			err:    err,
		}
		return nil
	})

	byDiagnostic := make(map[string]ssrrNamespaceResult, len(diagnosticKeys))
	for i, diagnosticKey := range diagnosticKeys {
		byDiagnostic[diagnosticKey] = results[i]
	}
	return byDiagnostic
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
	if a == nil {
		return
	}
	applog.Debug(
		a.logger,
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
//
//wails:ignore
func (a *App) ClearSSRRCache(clusterID string) {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()

	if cache, ok := a.ssrrCaches[clusterID]; ok {
		cache.Clear()
		delete(a.ssrrCaches, clusterID)
	}
}

// ClearAllSSRRCaches removes all cached SSRR rules for every cluster.
//
//wails:ignore
func (a *App) ClearAllSSRRCaches() {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()

	for _, cache := range a.ssrrCaches {
		cache.Clear()
	}
	a.ssrrCaches = make(map[string]*capabilities.SSRRCache)
}
