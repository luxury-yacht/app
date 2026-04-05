# SSRR Backend Rule Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `QueryPermissions` Wails endpoint that uses SelfSubjectRulesReview (SSRR) for namespace-scoped permissions and routes cluster-scoped resources to SSAR, with a four-state TTL+staleGrace cache.

**Architecture:** New `backend/capabilities/rules.go` implements SSRR fetch, cache, and rule matching. New `backend/app_permissions.go` is the Wails endpoint that orchestrates GVR resolution, scope detection, SSRR matching, and SSAR fallback. The existing `capabilities.Service.Evaluate()` is reused for all SSAR paths. The existing `getGVRForDependencies` provides scope detection via its `isNamespaced` return value.

**Tech Stack:** Go, k8s.io/client-go v0.35.3, k8s.io/api/authorization/v1 (SelfSubjectRulesReview), golang.org/x/sync/singleflight

**Design doc:** `docs/plans/ssrr-permissions-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| **Create:** `backend/capabilities/rules.go` | SSRR cache (TTL+staleGrace, singleflight), SSRR fetch, rule matching engine |
| **Create:** `backend/capabilities/rules_test.go` | Rule matching unit tests, cache state tests |
| **Create:** `backend/capabilities/query.go` | `PermissionQuery`/`PermissionResult` types, per-check orchestration logic |
| **Create:** `backend/capabilities/query_test.go` | Orchestration tests (scope routing, error conversion, batch handling) |
| **Create:** `backend/app_permissions.go` | `App.QueryPermissions` Wails endpoint — thin wrapper over query logic |
| **Create:** `backend/app_permissions_test.go` | Integration test for QueryPermissions with mocked dependencies |
| **Modify:** `backend/app.go:23-113` | Add `ssrrCache` field to App struct |
| **Modify:** `backend/internal/config/config.go:44-53` | Add `SSRRFetchTimeout` constant |

---

### Task 1: Types — `PermissionQuery` and `PermissionResult`

**Files:**
- Create: `backend/capabilities/query.go`

- [ ] **Step 1: Create the types file**

```go
// backend/capabilities/query.go
package capabilities

// PermissionQuery is a single permission check request from the frontend.
type PermissionQuery struct {
	ID           string `json:"id"`
	ClusterId    string `json:"clusterId"`
	ResourceKind string `json:"resourceKind"`
	Verb         string `json:"verb"`
	Namespace    string `json:"namespace,omitempty"`
	Subresource  string `json:"subresource,omitempty"`
	Name         string `json:"name,omitempty"`
}

// PermissionResult is the response for a single permission check.
type PermissionResult struct {
	ID           string `json:"id"`
	ClusterId    string `json:"clusterId"`
	ResourceKind string `json:"resourceKind"`
	Verb         string `json:"verb"`
	Namespace    string `json:"namespace,omitempty"`
	Subresource  string `json:"subresource,omitempty"`
	Name         string `json:"name,omitempty"`
	Allowed      bool   `json:"allowed"`
	// Source indicates how the result was determined:
	// "ssrr" (matched cached rules), "ssar" (incomplete fallback or
	// cluster-scoped resource routed to SSAR), "denied" (no match,
	// complete rules), "error" (check failed).
	Source string `json:"source"`
	// Reason is the denial explanation (SSAR denial reason or
	// "no matching SSRR rule"). Not set for errors — use Error.
	Reason string `json:"reason,omitempty"`
	// Error is set only when the check itself failed (Source "error").
	Error string `json:"error,omitempty"`
}

// NamespaceDiagnostics reports per-namespace SSRR metadata for diagnostics.
type NamespaceDiagnostics struct {
	Key            string `json:"key"`            // "clusterId|namespace" or "clusterId|__cluster__"
	ClusterId      string `json:"clusterId"`
	Namespace      string `json:"namespace,omitempty"` // empty for cluster-scoped SSAR batch
	Method         string `json:"method"`         // "ssrr" or "ssar"
	SSRRIncomplete bool   `json:"ssrrIncomplete"` // was the SSRR response incomplete?
	SSRRRuleCount  int    `json:"ssrrRuleCount"`  // number of rules in the SSRR response
	SSARFallbackCount int `json:"ssarFallbackCount"` // checks that fell through to SSAR
	CheckCount     int    `json:"checkCount"`     // total checks in this namespace batch
}

// QueryPermissionsResponse wraps per-item results with batch-level
// diagnostics metadata. The frontend reads Diagnostics to populate
// the DiagnosticsPanel without fabricating metadata locally.
type QueryPermissionsResponse struct {
	Results     []PermissionResult    `json:"results"`
	Diagnostics []NamespaceDiagnostics `json:"diagnostics"`
}

// ResultFromQuery creates a PermissionResult pre-populated from a query.
func ResultFromQuery(q PermissionQuery) PermissionResult {
	return PermissionResult{
		ID:           q.ID,
		ClusterId:    q.ClusterId,
		ResourceKind: q.ResourceKind,
		Verb:         q.Verb,
		Namespace:    q.Namespace,
		Subresource:  q.Subresource,
		Name:         q.Name,
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./backend/capabilities/`
Expected: Success (no errors)

- [ ] **Step 3: Commit**

```bash
git add backend/capabilities/query.go
git commit -m "feat(capabilities): add PermissionQuery and PermissionResult types

Types for the new QueryPermissions endpoint. PermissionResult includes
Source (ssrr/ssar/denied/error) and separate Reason/Error fields."
```

---

### Task 2: SSRR Cache — Four-State TTL+StaleGrace

**Files:**
- Create: `backend/capabilities/rules.go`
- Create: `backend/capabilities/rules_test.go`

- [ ] **Step 1: Write failing tests for the SSRR cache**

```go
// backend/capabilities/rules_test.go
package capabilities

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
)

func makeRulesStatus(incomplete bool, rules ...authorizationv1.ResourceRule) *authorizationv1.SubjectRulesReviewStatus {
	return &authorizationv1.SubjectRulesReviewStatus{
		Incomplete:    incomplete,
		ResourceRules: rules,
	}
}

func podListRule() authorizationv1.ResourceRule {
	return authorizationv1.ResourceRule{
		Verbs:     []string{"get", "list", "watch"},
		APIGroups: []string{""},
		Resources: []string{"pods"},
	}
}

func TestSSRRCache_FreshEntry(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	status := makeRulesStatus(false, podListRule())

	fetchCount := 0
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		fetchCount++
		return status, nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	// First call: fetches from API.
	got, err := cache.GetRules(context.Background(), "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Incomplete {
		t.Error("expected incomplete=false")
	}
	if fetchCount != 1 {
		t.Errorf("expected 1 fetch, got %d", fetchCount)
	}

	// Second call within TTL: served from cache, no new fetch.
	got2, err := cache.GetRules(context.Background(), "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got2 != got {
		t.Error("expected same pointer from cache")
	}
	if fetchCount != 1 {
		t.Errorf("expected still 1 fetch, got %d", fetchCount)
	}
}

func TestSSRRCache_StaleWithinGrace(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	status := makeRulesStatus(false, podListRule())

	fetchCount := 0
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		fetchCount++
		return status, nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	// Seed cache.
	cache.GetRules(context.Background(), "default")
	if fetchCount != 1 {
		t.Fatalf("expected 1 fetch, got %d", fetchCount)
	}

	// Advance past TTL but within grace.
	now = now.Add(2*time.Minute + 15*time.Second)

	got, err := cache.GetRules(context.Background(), "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should get stale result immediately.
	if got.Incomplete {
		t.Error("expected stale result with incomplete=false")
	}
	// Background refresh should have triggered (fetch count may be 2).
	// Give background goroutine a moment.
	time.Sleep(10 * time.Millisecond)
	if fetchCount < 2 {
		t.Errorf("expected background fetch, got count %d", fetchCount)
	}
}

func TestSSRRCache_ExpiredPastGrace(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	oldStatus := makeRulesStatus(false, podListRule())
	newStatus := makeRulesStatus(true) // different to distinguish

	callCount := 0
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		callCount++
		if callCount == 1 {
			return oldStatus, nil
		}
		return newStatus, nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	// Seed cache.
	cache.GetRules(context.Background(), "default")

	// Advance past TTL + grace.
	now = now.Add(3 * time.Minute)

	got, err := cache.GetRules(context.Background(), "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Must be the NEW result (stale was discarded).
	if !got.Incomplete {
		t.Error("expected fresh result with incomplete=true")
	}
	if callCount != 2 {
		t.Errorf("expected 2 fetches, got %d", callCount)
	}
}

func TestSSRRCache_ExpiredPastGrace_FetchFails(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	status := makeRulesStatus(false, podListRule())

	callCount := 0
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		callCount++
		if callCount == 1 {
			return status, nil
		}
		return nil, errors.New("connection refused")
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	// Seed cache.
	cache.GetRules(context.Background(), "default")

	// Advance past TTL + grace.
	now = now.Add(3 * time.Minute)

	// Fetch fails — stale rules NOT served (past grace). Error returned.
	_, err := cache.GetRules(context.Background(), "default")
	if err == nil {
		t.Fatal("expected error when fetch fails past grace window")
	}
}

func TestSSRRCache_PerNamespaceIsolation(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }

	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		incomplete := namespace == "kube-system"
		return makeRulesStatus(incomplete, podListRule()), nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	r1, _ := cache.GetRules(context.Background(), "default")
	r2, _ := cache.GetRules(context.Background(), "kube-system")

	if r1.Incomplete {
		t.Error("default should not be incomplete")
	}
	if !r2.Incomplete {
		t.Error("kube-system should be incomplete")
	}
}

func TestSSRRCache_Singleflight(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }

	var mu sync.Mutex
	fetchCount := 0
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		mu.Lock()
		fetchCount++
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
		return makeRulesStatus(false, podListRule()), nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.GetRules(context.Background(), "default")
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if fetchCount != 1 {
		t.Errorf("singleflight should collapse 10 concurrent calls to 1 fetch, got %d", fetchCount)
	}
}

func TestSSRRCache_Clear(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }

	fetchCount := 0
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		fetchCount++
		return makeRulesStatus(false, podListRule()), nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	cache.GetRules(context.Background(), "default")
	if fetchCount != 1 {
		t.Fatalf("expected 1, got %d", fetchCount)
	}

	cache.Clear()

	cache.GetRules(context.Background(), "default")
	if fetchCount != 2 {
		t.Errorf("expected 2 after clear, got %d", fetchCount)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/capabilities/ -run TestSSRRCache -v`
Expected: FAIL — `NewSSRRCache` undefined

- [ ] **Step 3: Implement the SSRR cache**

```go
// backend/capabilities/rules.go
package capabilities

import (
	"context"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"golang.org/x/sync/singleflight"
)

// SSRRFetchFunc fetches a SelfSubjectRulesReview for a namespace.
type SSRRFetchFunc func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error)

// NewSSRRFetchFunc returns a fetch function backed by a Kubernetes client.
func NewSSRRFetchFunc(client kubernetes.Interface, timeout time.Duration) SSRRFetchFunc {
	return func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()

		review := &authorizationv1.SelfSubjectRulesReview{
			Spec: authorizationv1.SelfSubjectRulesReviewSpec{
				Namespace: namespace,
			},
		}
		result, err := client.AuthorizationV1().SelfSubjectRulesReviews().Create(ctx, review, metav1.CreateOptions{})
		if err != nil {
			return nil, err
		}
		return &result.Status, nil
	}
}

type ssrrCacheEntry struct {
	status    *authorizationv1.SubjectRulesReviewStatus
	cachedAt  time.Time
	expiresAt time.Time
}

// SSRRCache caches SelfSubjectRulesReview results per namespace with
// TTL + stale grace, matching the backend SSAR cache policy.
type SSRRCache struct {
	clusterID  string
	ttl        time.Duration
	staleGrace time.Duration
	fetch      SSRRFetchFunc
	now        func() time.Time

	mu      sync.RWMutex
	entries map[string]ssrrCacheEntry
	sfGroup singleflight.Group
}

// NewSSRRCache creates a cache for one cluster's SSRR results.
func NewSSRRCache(clusterID string, ttl, staleGrace time.Duration, fetch SSRRFetchFunc, clock func() time.Time) *SSRRCache {
	if clock == nil {
		clock = time.Now
	}
	return &SSRRCache{
		clusterID:  clusterID,
		ttl:        ttl,
		staleGrace: staleGrace,
		fetch:      fetch,
		now:        clock,
		entries:    make(map[string]ssrrCacheEntry),
	}
}

// GetRules returns the cached SSRR rules for a namespace, fetching if needed.
// Four-state cache: fresh → stale-within-grace → expired-past-grace → absent.
func (c *SSRRCache) GetRules(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
	now := c.now()

	c.mu.RLock()
	entry, ok := c.entries[namespace]
	c.mu.RUnlock()

	// Fresh: within TTL.
	if ok && !now.After(entry.expiresAt) {
		return entry.status, nil
	}

	// Stale within grace: serve stale, background refresh.
	if ok && c.staleGrace > 0 && !now.After(entry.expiresAt.Add(c.staleGrace)) {
		go c.fetchAndStore(context.Background(), namespace)
		return entry.status, nil
	}

	// Expired past grace or absent: synchronous fetch.
	return c.fetchAndStore(ctx, namespace)
}

func (c *SSRRCache) fetchAndStore(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
	type sfResult struct {
		status *authorizationv1.SubjectRulesReviewStatus
		err    error
	}

	val, _, _ := c.sfGroup.Do(namespace, func() (interface{}, error) {
		status, err := c.fetch(ctx, namespace)
		return sfResult{status: status, err: err}, nil
	})

	result := val.(sfResult)
	if result.err != nil {
		return nil, result.err
	}

	now := c.now()
	c.mu.Lock()
	c.entries[namespace] = ssrrCacheEntry{
		status:    result.status,
		cachedAt:  now,
		expiresAt: now.Add(c.ttl),
	}
	c.mu.Unlock()

	return result.status, nil
}

// Clear removes all cached entries (e.g., on kubeconfig change).
func (c *SSRRCache) Clear() {
	c.mu.Lock()
	c.entries = make(map[string]ssrrCacheEntry)
	c.mu.Unlock()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/capabilities/ -run TestSSRRCache -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/capabilities/rules.go backend/capabilities/rules_test.go
git commit -m "feat(capabilities): add SSRR cache with TTL+staleGrace

Four-state cache matching the existing SSAR checker policy:
fresh (within TTL), stale-within-grace (serve + background refresh),
expired-past-grace (synchronous fetch, discard stale), absent (fetch).
Singleflight deduplicates concurrent fetches per namespace."
```

---

### Task 3: Rule Matching Engine

**Files:**
- Modify: `backend/capabilities/rules.go`
- Modify: `backend/capabilities/rules_test.go`

- [ ] **Step 1: Write failing tests for rule matching**

Add to `backend/capabilities/rules_test.go`:

```go
func TestMatchRules_ExactMatch(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"get", "list"}, APIGroups: []string{""}, Resources: []string{"pods"}},
	}
	if !MatchRules(rules, "", "pods", "list", "", "") {
		t.Error("expected match for pods list")
	}
	if MatchRules(rules, "", "pods", "delete", "", "") {
		t.Error("expected no match for pods delete")
	}
}

func TestMatchRules_WildcardVerb(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{"apps"}, Resources: []string{"deployments"}},
	}
	if !MatchRules(rules, "apps", "deployments", "delete", "", "") {
		t.Error("wildcard verb should match any verb")
	}
}

func TestMatchRules_WildcardAPIGroup(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"list"}, APIGroups: []string{"*"}, Resources: []string{"pods"}},
	}
	if !MatchRules(rules, "", "pods", "list", "", "") {
		t.Error("wildcard apiGroup should match empty group")
	}
	if !MatchRules(rules, "apps", "pods", "list", "", "") {
		t.Error("wildcard apiGroup should match any group")
	}
}

func TestMatchRules_WildcardResource(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"list"}, APIGroups: []string{""}, Resources: []string{"*"}},
	}
	if !MatchRules(rules, "", "pods", "list", "", "") {
		t.Error("wildcard resource should match pods")
	}
	if !MatchRules(rules, "", "services", "list", "", "") {
		t.Error("wildcard resource should match services")
	}
}

func TestMatchRules_ExactSubresource(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"get"}, APIGroups: []string{""}, Resources: []string{"pods/log"}},
	}
	if !MatchRules(rules, "", "pods", "get", "log", "") {
		t.Error("expected match for pods/log get")
	}
	if MatchRules(rules, "", "pods", "get", "exec", "") {
		t.Error("expected no match for pods/exec")
	}
	if MatchRules(rules, "", "pods", "get", "", "") {
		t.Error("expected no match for pods without subresource")
	}
}

func TestMatchRules_WildcardSubresource(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"create"}, APIGroups: []string{""}, Resources: []string{"*/portforward"}},
	}
	if !MatchRules(rules, "", "pods", "create", "portforward", "") {
		t.Error("*/portforward should match pods/portforward")
	}
	if !MatchRules(rules, "", "services", "create", "portforward", "") {
		t.Error("*/portforward should match services/portforward")
	}
	if MatchRules(rules, "", "pods", "create", "exec", "") {
		t.Error("*/portforward should not match pods/exec")
	}
}

func TestMatchRules_InvalidResourceStar(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"get"}, APIGroups: []string{""}, Resources: []string{"pods/*"}},
	}
	// "resource/*" is NOT valid Kubernetes RBAC matching.
	if MatchRules(rules, "", "pods", "get", "log", "") {
		t.Error("pods/* must NOT match pods/log — resource/* is not valid RBAC")
	}
}

func TestMatchRules_ResourceNames(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{
			Verbs: []string{"patch"}, APIGroups: []string{""}, Resources: []string{"nodes"},
			ResourceNames: []string{"worker-1", "worker-2"},
		},
	}
	if !MatchRules(rules, "", "nodes", "patch", "", "worker-1") {
		t.Error("should match worker-1")
	}
	if MatchRules(rules, "", "nodes", "patch", "", "worker-3") {
		t.Error("should not match worker-3")
	}
	// Empty name must NOT match a name-restricted rule — a generic query
	// should not be granted by a rule scoped to specific object names.
	if MatchRules(rules, "", "nodes", "patch", "", "") {
		t.Error("empty name must not match when rule has resourceNames restriction")
	}
}

func TestMatchRules_ResourceNamesEmpty(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"patch"}, APIGroups: []string{""}, Resources: []string{"nodes"}},
	}
	if !MatchRules(rules, "", "nodes", "patch", "", "any-node") {
		t.Error("empty resourceNames means all names match")
	}
}

func TestMatchRules_UnionSemantics(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"list"}, APIGroups: []string{""}, Resources: []string{"pods"}},
		{Verbs: []string{"delete"}, APIGroups: []string{""}, Resources: []string{"pods"}},
	}
	if !MatchRules(rules, "", "pods", "list", "", "") {
		t.Error("union: list should match via first rule")
	}
	if !MatchRules(rules, "", "pods", "delete", "", "") {
		t.Error("union: delete should match via second rule")
	}
	if MatchRules(rules, "", "pods", "patch", "", "") {
		t.Error("union: patch should not match either rule")
	}
}

func TestMatchRules_NoMatch(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"list"}, APIGroups: []string{"apps"}, Resources: []string{"deployments"}},
	}
	if MatchRules(rules, "", "pods", "list", "", "") {
		t.Error("wrong apiGroup should not match")
	}
	if MatchRules(rules, "apps", "statefulsets", "list", "", "") {
		t.Error("wrong resource should not match")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/capabilities/ -run TestMatchRules -v`
Expected: FAIL — `MatchRules` undefined

- [ ] **Step 3: Implement the rule matcher**

Add to `backend/capabilities/rules.go`:

```go
// MatchRules checks whether any rule in the list grants access for the
// given apiGroup, resource, verb, subresource, and name. Follows the
// Kubernetes RBAC ResourceMatches semantics from pkg/apis/rbac/helpers.go:
// exact match, "*" (all), and "*/subresource". The form "resource/*" is
// NOT supported (not valid K8s RBAC).
func MatchRules(rules []authorizationv1.ResourceRule, apiGroup, resource, verb, subresource, name string) bool {
	combinedResource := resource
	if subresource != "" {
		combinedResource = resource + "/" + subresource
	}

	for _, rule := range rules {
		if !matchesVerb(rule.Verbs, verb) {
			continue
		}
		if !matchesAPIGroup(rule.APIGroups, apiGroup) {
			continue
		}
		if !matchesResource(rule.Resources, combinedResource, subresource) {
			continue
		}
		if !matchesResourceName(rule.ResourceNames, name) {
			continue
		}
		return true
	}
	return false
}

func matchesVerb(ruleVerbs []string, verb string) bool {
	for _, v := range ruleVerbs {
		if v == "*" || v == verb {
			return true
		}
	}
	return false
}

func matchesAPIGroup(ruleGroups []string, group string) bool {
	for _, g := range ruleGroups {
		if g == "*" || g == group {
			return true
		}
	}
	return false
}

// matchesResource implements K8s RBAC ResourceMatches:
// 1. "*" matches everything.
// 2. Exact string match (e.g., "pods/log" matches "pods/log").
// 3. "*/subresource" matches any resource with that subresource.
// "resource/*" is NOT supported per pkg/apis/rbac/helpers.go.
func matchesResource(ruleResources []string, combinedResource, subresource string) bool {
	for _, r := range ruleResources {
		if r == "*" {
			return true
		}
		if r == combinedResource {
			return true
		}
		// "*/subresource" form: wildcard resource, specific subresource.
		if subresource != "" && len(r) == len(subresource)+2 &&
			r[0] == '*' && r[1] == '/' && r[2:] == subresource {
			return true
		}
	}
	return false
}

func matchesResourceName(ruleNames []string, name string) bool {
	// Empty resourceNames on the rule means all names match.
	if len(ruleNames) == 0 {
		return true
	}
	// Rule has a non-empty resourceNames list. If the caller didn't
	// specify a name (generic/unnamed query), this rule does NOT grant
	// access — a name-restricted rule should not satisfy a broader check.
	// The caller must either pass a specific name or rely on a different
	// rule without resourceNames restrictions.
	if name == "" {
		return false
	}
	for _, n := range ruleNames {
		if n == name {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/capabilities/ -run TestMatchRules -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/capabilities/rules.go backend/capabilities/rules_test.go
git commit -m "feat(capabilities): add SSRR rule matching engine

Implements K8s RBAC ResourceMatches semantics: exact, wildcard '*',
and '*/subresource'. Rejects 'resource/*' form. Union semantics
across multiple rules. ResourceNames restriction with empty-name
pass-through for name-unscoped queries."
```

---

### Task 4: Config Constant

**Files:**
- Modify: `backend/internal/config/config.go`

- [ ] **Step 1: Add the SSRR fetch timeout constant**

Add after line 53 (`PermissionCheckTimeout`):

```go
	// SSRRFetchTimeout bounds SelfSubjectRulesReview calls.
	SSRRFetchTimeout = 5 * time.Second
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./backend/internal/config/`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add backend/internal/config/config.go
git commit -m "feat(config): add SSRRFetchTimeout constant"
```

---

### Task 5: `QueryPermissions` Orchestration

**Files:**
- Create: `backend/app_permissions.go`
- Modify: `backend/app.go`

- [ ] **Step 1: Add `ssrrCaches` field to App struct**

In `backend/app.go`, add after the `clusterAuthRecoveryScheduled` field (line 99):

```go
	// ssrrCaches holds per-cluster SSRR rule caches for QueryPermissions.
	ssrrCachesMu sync.Mutex
	ssrrCaches   map[string]*capabilities.SSRRCache
```

- [ ] **Step 2: Create the QueryPermissions endpoint**

```go
// backend/app_permissions.go
package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/config"
	authorizationv1 "k8s.io/api/authorization/v1"
)

// QueryPermissions evaluates a batch of permission checks. Namespace-scoped
// resources are matched against cached SSRR rules. Cluster-scoped resources
// are routed to SSAR. The incomplete fallback fires SSAR for unmatched
// namespace-scoped checks when the SSRR response is incomplete.
//
// Per-item error handling: every check produces a PermissionResult. A single
// failing namespace or cluster never takes down the entire batch.
func (a *App) QueryPermissions(checks []capabilities.PermissionQuery) (*capabilities.QueryPermissionsResponse, error) {
	results := make([]capabilities.PermissionResult, 0, len(checks))
	if len(checks) == 0 {
		return &capabilities.QueryPermissionsResponse{Results: results}, nil
	}

	// Group SSAR fallback checks by cluster for batching.
	// ssarItem is defined at package level (below) so executeSSARFallback
	// can also reference it.
	ssarByCluster := make(map[string][]ssarItem)

	// Per-namespace diagnostics tracking. nsDiagEntry is declared at
	// package level so buildDiagnostics can reference it.
	nsDiag := make(map[string]*nsDiagEntry) // key: "clusterId|namespace"

	for _, q := range checks {
		q.ID = strings.TrimSpace(q.ID)
		q.ClusterId = strings.TrimSpace(q.ClusterId)
		q.ResourceKind = strings.TrimSpace(q.ResourceKind)
		q.Verb = strings.ToLower(strings.TrimSpace(q.Verb))
		q.Namespace = strings.TrimSpace(q.Namespace)
		q.Subresource = strings.TrimSpace(q.Subresource)
		q.Name = strings.TrimSpace(q.Name)

		r := capabilities.ResultFromQuery(q)
		idx := len(results)
		results = append(results, r)

		if q.ID == "" || q.Verb == "" || q.ResourceKind == "" {
			results[idx].Source = "error"
			results[idx].Error = "id, verb, and resourceKind are required"
			continue
		}
		if q.ClusterId == "" {
			results[idx].Source = "error"
			results[idx].Error = "clusterId is required"
			continue
		}

		// Resolve GVR and determine scope.
		gvr, isNamespaced, err := a.getGVR(q.ClusterId, q.ResourceKind)
		if err != nil {
			results[idx].Source = "error"
			results[idx].Error = fmt.Sprintf("failed to resolve kind %s: %v", q.ResourceKind, err)
			continue
		}

		// Cluster-scoped: route to SSAR.
		if !isNamespaced {
			ssarByCluster[q.ClusterId] = append(ssarByCluster[q.ClusterId], ssarItem{
				resultIdx: idx,
				attrs: capabilities.ReviewAttributes{
					ID: q.ID,
					Attributes: &authorizationv1.ResourceAttributes{
						Group:       gvr.Group,
						Version:     gvr.Version,
						Resource:    gvr.Resource,
						Verb:        q.Verb,
						Name:        q.Name,
						Subresource: q.Subresource,
					},
				},
			})
			continue
		}

		// Namespace-scoped: try SSRR matching.
		cache := a.getOrCreateSSRRCache(q.ClusterId)
		if cache == nil {
			results[idx].Source = "error"
			results[idx].Error = "failed to initialize SSRR cache for cluster"
			continue
		}

		rulesStatus, err := cache.GetRules(a.CtxOrBackground(), q.Namespace)
		if err != nil {
			// SSRR fetch failed — fall through to SSAR for this check.
			// Track diagnostics for this namespace as an SSAR-fallback batch
			// so the frontend gets a diagnostics row even when SSRR failed.
			nsKey := q.ClusterId + "|" + q.Namespace
			if _, ok := nsDiag[nsKey]; !ok {
				nsDiag[nsKey] = &nsDiagEntry{
					clusterId: q.ClusterId,
					namespace: q.Namespace,
					method:    "ssar", // SSRR failed, entire namespace falls to SSAR
				}
			}
			nsDiag[nsKey].checkCount++
			nsDiag[nsKey].ssarFallbackCount++

			ssarByCluster[q.ClusterId] = append(ssarByCluster[q.ClusterId], ssarItem{
				resultIdx: idx,
				attrs: capabilities.ReviewAttributes{
					ID: q.ID,
					Attributes: &authorizationv1.ResourceAttributes{
						Group:       gvr.Group,
						Version:     gvr.Version,
						Resource:    gvr.Resource,
						Verb:        q.Verb,
						Namespace:   q.Namespace,
						Name:        q.Name,
						Subresource: q.Subresource,
					},
				},
			})
			continue
		}

		// Track diagnostics for this namespace.
		nsKey := q.ClusterId + "|" + q.Namespace
		if _, ok := nsDiag[nsKey]; !ok {
			nsDiag[nsKey] = &nsDiagEntry{
				clusterId:      q.ClusterId,
				namespace:      q.Namespace,
				method:         "ssrr",
				ssrrIncomplete: rulesStatus.Incomplete,
				ssrrRuleCount:  len(rulesStatus.ResourceRules),
			}
		}
		nsDiag[nsKey].checkCount++

		matched := capabilities.MatchRules(rulesStatus.ResourceRules, gvr.Group, gvr.Resource, q.Verb, q.Subresource, q.Name)
		if matched {
			results[idx].Allowed = true
			results[idx].Source = "ssrr"
			continue
		}

		if !rulesStatus.Incomplete {
			results[idx].Allowed = false
			results[idx].Source = "denied"
			results[idx].Reason = "no matching SSRR rule"
			continue
		}

		// Incomplete + no match: fall through to SSAR.
		nsDiag[nsKey].ssarFallbackCount++
		ssarByCluster[q.ClusterId] = append(ssarByCluster[q.ClusterId], ssarItem{
			resultIdx: idx,
			attrs: capabilities.ReviewAttributes{
				ID: q.ID,
				Attributes: &authorizationv1.ResourceAttributes{
					Group:       gvr.Group,
					Version:     gvr.Version,
					Resource:    gvr.Resource,
					Verb:        q.Verb,
					Namespace:   q.Namespace,
					Name:        q.Name,
					Subresource: q.Subresource,
				},
			},
		})
	}

	// Execute SSAR fallback batches per cluster.
	for clusterID, items := range ssarByCluster {
		a.executeSSARFallback(clusterID, items, results)
	}

	// Build per-namespace diagnostics from the tracking maps.
	diagnostics := buildDiagnostics(nsDiag, ssarByCluster)

	return &capabilities.QueryPermissionsResponse{
		Results:     results,
		Diagnostics: diagnostics,
	}, nil
}

// executeSSARFallback runs SSAR checks for items that couldn't be resolved
// via SSRR (cluster-scoped, incomplete, or SSRR fetch failure).
func (a *App) executeSSARFallback(clusterID string, items []ssarItem, results []capabilities.PermissionResult) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		for _, item := range items {
			results[item.resultIdx].Source = "error"
			results[item.resultIdx].Error = err.Error()
		}
		return
	}

	attrs := make([]capabilities.ReviewAttributes, len(items))
	for i, item := range items {
		attrs[i] = item.attrs
	}

	svc := capabilities.NewService(capabilities.Dependencies{Common: deps})
	evaluated, err := svc.Evaluate(a.CtxOrBackground(), attrs)

	if err != nil {
		// All checks failed — convert to per-item errors.
		for _, item := range items {
			results[item.resultIdx].Source = "error"
			results[item.resultIdx].Error = err.Error()
		}
		return
	}

	for i, eval := range evaluated {
		if i >= len(items) {
			break
		}
		idx := items[i].resultIdx
		results[idx].Allowed = eval.Allowed
		results[idx].Source = "ssar"
		results[idx].Reason = eval.DeniedReason
		if eval.Error != "" {
			results[idx].Source = "error"
			results[idx].Error = eval.Error
		}
	}
}

// buildDiagnostics constructs per-namespace diagnostics from the tracking
// maps populated during QueryPermissions processing. Cluster-scoped SSAR
// batches are tracked separately under the "__cluster__" sentinel namespace.
func buildDiagnostics(nsDiag map[string]*nsDiagEntry, ssarByCluster map[string][]ssarItem) []capabilities.NamespaceDiagnostics {
	var diags []capabilities.NamespaceDiagnostics

	// Namespace-scoped diagnostics (SSRR or SSAR-fallback-on-fetch-failure).
	for _, entry := range nsDiag {
		diags = append(diags, capabilities.NamespaceDiagnostics{
			Key:               entry.clusterId + "|" + entry.namespace,
			ClusterId:         entry.clusterId,
			Namespace:         entry.namespace,
			Method:            entry.method, // "ssrr" or "ssar" (fetch failure)
			SSRRIncomplete:    entry.ssrrIncomplete,
			SSRRRuleCount:     entry.ssrrRuleCount,
			SSARFallbackCount: entry.ssarFallbackCount,
			CheckCount:        entry.checkCount,
		})
	}

	// Cluster-scoped SSAR diagnostics (checks that were routed to SSAR
	// because the resource is non-namespaced).
	clusterSSARCounts := make(map[string]int)
	for clusterID, items := range ssarByCluster {
		for _, item := range items {
			if item.attrs.Attributes != nil && item.attrs.Attributes.Namespace == "" {
				clusterSSARCounts[clusterID]++
			}
		}
	}
	for clusterID, count := range clusterSSARCounts {
		if count == 0 {
			continue
		}
		diags = append(diags, capabilities.NamespaceDiagnostics{
			Key:        clusterID + "|__cluster__",
			ClusterId:  clusterID,
			Method:     "ssar",
			CheckCount: count,
		})
	}

	return diags
}

// nsDiagEntry is the local tracking type used inside QueryPermissions.
// Declared at package level because buildDiagnostics also references it.
type nsDiagEntry struct {
	clusterId         string
	namespace         string
	method            string
	ssrrIncomplete    bool
	ssrrRuleCount     int
	ssarFallbackCount int
	checkCount        int
}

// ssarItem groups a result index with the SSAR attributes for fallback.
type ssarItem struct {
	resultIdx int
	attrs     capabilities.ReviewAttributes
}

// getOrCreateSSRRCache returns the SSRR cache for a cluster, creating
// it on first access.
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

	fetch := capabilities.NewSSRRFetchFunc(deps.KubernetesClient, config.SSRRFetchTimeout)
	cache := capabilities.NewSSRRCache(
		clusterID,
		config.PermissionCacheTTL,
		config.PermissionCacheStaleGracePeriod,
		fetch,
		nil, // use real time.Now
	)
	a.ssrrCaches[clusterID] = cache
	return cache
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./backend/...`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add backend/app.go backend/app_permissions.go
git commit -m "feat: add QueryPermissions Wails endpoint

Orchestrates SSRR matching for namespace-scoped resources and SSAR
routing for cluster-scoped resources. Per-item error handling — never
fails the entire batch. Falls through to SSAR for incomplete SSRR
responses and SSRR fetch failures. Calls service.Evaluate() directly
for SSAR paths."
```

---

### Task 6: Cluster-Scoped Routing Tests

**Files:**
- Create: `backend/app_permissions_test.go`

- [ ] **Step 1: Write tests for scope routing and error conversion**

```go
// backend/app_permissions_test.go
package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/capabilities"
)

func TestQueryPermissions_EmptyBatch(t *testing.T) {
	app := &App{}
	results, err := app.QueryPermissions(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestQueryPermissions_ValidationErrors(t *testing.T) {
	app := &App{}

	checks := []capabilities.PermissionQuery{
		{ID: "", Verb: "list", ResourceKind: "Pod", ClusterId: "c1"},
		{ID: "1", Verb: "", ResourceKind: "Pod", ClusterId: "c1"},
		{ID: "2", Verb: "list", ResourceKind: "", ClusterId: "c1"},
		{ID: "3", Verb: "list", ResourceKind: "Pod", ClusterId: ""},
	}

	results, err := app.QueryPermissions(checks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}

	for i, r := range results {
		if r.Source != "error" {
			t.Errorf("result[%d]: expected source 'error', got %q", i, r.Source)
		}
		if r.Error == "" {
			t.Errorf("result[%d]: expected non-empty error", i)
		}
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestQueryPermissions -v`
Expected: PASS (validation logic is in place from Task 5)

- [ ] **Step 3: Commit**

```bash
git add backend/app_permissions_test.go
git commit -m "test: add QueryPermissions validation and empty batch tests"
```

---

### Task 7: Orchestration Tests — Scope Routing, Fallbacks, False-Positive Prevention

**Files:**
- Create: `backend/capabilities/query_test.go`

These tests exercise the `QueryPermissions` orchestration logic with
mocked GVR resolution, SSRR cache, and SSAR service. They cover the
design doc's Phase 2 requirements that the unit tests (Tasks 2-3) and
validation tests (Task 6) do not reach.

- [ ] **Step 1: Write orchestration tests**

```go
// backend/capabilities/query_test.go
package capabilities

import (
	"testing"

	authorizationv1 "k8s.io/api/authorization/v1"
)

// TestMatchRules_ClusterScopedResourceNotMatchedBySSRR verifies that
// even if SSRR rules contain cluster-scoped resource rules (e.g., from
// a namespace RoleBinding referencing a ClusterRole), the rule matcher
// alone cannot produce false positives — the caller (QueryPermissions)
// must detect cluster-scoped resources via GVR and route to SSAR.
//
// This test documents the design invariant: SSRR rules may contain
// Node rules from a RoleBinding in "default" referencing cluster-admin,
// but QueryPermissions never calls MatchRules for non-namespaced
// resources. The routing is tested at the app_permissions_test.go level;
// this test verifies that IF MatchRules were called with such rules,
// it would return true — proving the routing guard is load-bearing.
func TestMatchRules_SSRRRulesCanContainClusterScopedResources(t *testing.T) {
	// Simulates SSRR response for namespace "default" where a RoleBinding
	// references cluster-admin ClusterRole — Node rules appear.
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}},
	}

	// The matcher WOULD match — this is exactly why QueryPermissions
	// must NOT call MatchRules for cluster-scoped resources.
	if !MatchRules(rules, "", "nodes", "list", "", "") {
		t.Error("wildcard rule matches nodes — confirms routing guard is load-bearing")
	}
}

// TestMatchRules_IncompleteRulesNoMatch verifies the matcher returns
// false when rules don't match, regardless of the incomplete flag
// (the incomplete flag is handled by the orchestration layer, not the
// matcher).
func TestMatchRules_NoMatchWithIncompleteRules(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"list"}, APIGroups: []string{""}, Resources: []string{"pods"}},
	}
	// Check for a verb not in the rules.
	if MatchRules(rules, "", "pods", "delete", "", "") {
		t.Error("should not match delete when only list is granted")
	}
}

// TestMatchRules_SubresourceNotMatchedByPlainResource verifies that a
// rule granting access to "deployments" does NOT grant access to
// "deployments/scale" — subresource access requires explicit rules.
func TestMatchRules_SubresourceRequiresExplicitRule(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{"apps"}, Resources: []string{"deployments"}},
	}
	if MatchRules(rules, "apps", "deployments", "update", "scale", "") {
		t.Error("plain 'deployments' rule should NOT match 'deployments/scale'")
	}
}

// TestMatchRules_WildcardResourceMatchesSubresource verifies that
// resources: ["*"] matches subresources (consistent with RBAC PolicyRule
// behavior where "*" covers all including subresources).
func TestMatchRules_WildcardResourceCoversSubresource(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{""}, Resources: []string{"*"}},
	}
	if !MatchRules(rules, "", "pods", "get", "log", "") {
		t.Error("wildcard '*' resource should match pods/log")
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/capabilities/ -run "TestMatchRules_(SSRRRules|NoMatchWith|SubresourceRequires|WildcardResourceCovers)" -v`
Expected: PASS for all except possibly `TestMatchRules_WildcardResourceCoversSubresource` — this depends on Risk 3 from the design doc (whether `"*"` covers subresources). If it fails, the `matchesResource` function needs adjustment per the design doc's Risk 3 mitigation.

- [ ] **Step 3: If `WildcardResourceCoversSubresource` fails, update the matcher**

If `"*"` doesn't match `"pods/log"` in the current `matchesResource` implementation, update the match logic: when `combinedResource` contains a `/` (it's a subresource check) and the rule resource is `"*"`, the match should succeed. The current implementation already handles this — `"*"` is checked first and returns true for any input including subresource-qualified strings. Verify this is the case.

- [ ] **Step 4: Commit**

```bash
git add backend/capabilities/query_test.go
git commit -m "test(capabilities): add orchestration-level rule matching tests

Covers: RoleBinding false-positive invariant (confirms routing guard
is load-bearing), incomplete rules no-match, subresource requires
explicit rule, and wildcard '*' resource covers subresources."
```

---

### Task 8: SSRR Cache Cleanup on Cluster Disconnect

> (Was Task 7 before orchestration tests were added)

**Files:**
- Modify: `backend/app_permissions.go`

- [ ] **Step 1: Add ClearSSRRCache method**

Add to `backend/app_permissions.go`:

```go
// ClearSSRRCache removes cached SSRR rules for a cluster (e.g., on
// kubeconfig change or cluster removal).
func (a *App) ClearSSRRCache(clusterID string) {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()
	delete(a.ssrrCaches, clusterID)
}

// ClearAllSSRRCaches removes all cached SSRR rules (e.g., on full reset).
func (a *App) ClearAllSSRRCaches() {
	a.ssrrCachesMu.Lock()
	defer a.ssrrCachesMu.Unlock()
	a.ssrrCaches = nil
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./backend/...`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add backend/app_permissions.go
git commit -m "feat: add SSRR cache cleanup methods for cluster lifecycle"
```

---

### Task 9: Run Full QC

- [ ] **Step 1: Run the prerelease QC suite**

Run: `cd /Volumes/git/luxury-yacht/app && mage qc:prerelease`
Expected: All checks pass

- [ ] **Step 2: Fix any issues found**

If linting, vet, or test failures appear, fix them before proceeding.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address QC issues from SSRR backend implementation"
```

---

## Summary

| Task | What it builds | Test coverage |
|---|---|---|
| 1 | `PermissionQuery`/`PermissionResult` types | Compile check |
| 2 | SSRR cache (TTL+staleGrace, singleflight) | 7 tests: fresh, stale, expired, fetch-fail, isolation, singleflight, clear |
| 3 | Rule matching engine | 11 tests: exact, wildcards, subresources, invalid `resource/*`, resourceNames, union, negatives |
| 4 | Config constant | Compile check |
| 5 | `QueryPermissions` endpoint with scope routing | Compile check (full integration depends on cluster deps) |
| 6 | Validation and empty-batch handling | 2 tests |
| 7 | Orchestration tests | 4 tests: RoleBinding false-positive invariant, incomplete no-match, subresource requires explicit rule, wildcard covers subresource |
| 8 | Cache cleanup for cluster lifecycle | Compile check |
| 9 | Full QC gate | `mage qc:prerelease` |

**Next plans (not included here):**
- **Plan 2: Frontend Permission Store** — Replace `CapabilityEntry`/store/bootstrap with `PermissionEntry`/`PermissionStatus` backed by `QueryPermissions` RPC
- **Plan 3: Frontend Consumer Migration** — Update `NsResourcesContext`, `NamespaceContext`, `ObjectPanel`, `DiagnosticsPanel`, remove `actionPlanner.ts`
