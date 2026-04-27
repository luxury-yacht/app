package capabilities

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
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

func TestNewSSRRFetchFuncRetriesTooManyRequests(t *testing.T) {
	client := fake.NewClientset()
	calls := 0
	client.Fake.PrependReactor("create", "selfsubjectrulesreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		calls++
		if calls == 1 {
			return true, nil, apierrors.NewTooManyRequests("busy", 0)
		}
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectRulesReview)
		review.Status = authorizationv1.SubjectRulesReviewStatus{
			ResourceRules: []authorizationv1.ResourceRule{podListRule()},
		}
		return true, review, nil
	})

	fetch := NewSSRRFetchFunc(client, time.Second)
	status, err := fetch(context.Background(), "default")
	if err != nil {
		t.Fatalf("expected retry to succeed, got %v", err)
	}
	if len(status.ResourceRules) != 1 {
		t.Fatalf("expected retried SSRR status, got %+v", status)
	}
	if calls != 2 {
		t.Fatalf("expected 2 SSRR calls, got %d", calls)
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
	var mu sync.Mutex
	now := time.Now()
	clock := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return now
	}
	status := makeRulesStatus(false, podListRule())

	var fetchCount atomic.Int32
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		fetchCount.Add(1)
		return status, nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)

	// Seed cache.
	cache.GetRules(context.Background(), "default")
	if fetchCount.Load() != 1 {
		t.Fatalf("expected 1 fetch, got %d", fetchCount.Load())
	}

	// Advance past TTL but within grace.
	mu.Lock()
	now = now.Add(2*time.Minute + 15*time.Second)
	mu.Unlock()

	got, err := cache.GetRules(context.Background(), "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should get stale result immediately.
	if got.Incomplete {
		t.Error("expected stale result with incomplete=false")
	}
	// Background refresh should have triggered.
	// Poll briefly rather than relying on a fixed sleep.
	for range 50 {
		if fetchCount.Load() >= 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if fetchCount.Load() < 2 {
		t.Errorf("expected background fetch, got count %d", fetchCount.Load())
	}
}

func TestSSRRCache_StaleWithinGraceDeduplicatesBackgroundRefresh(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	status := makeRulesStatus(false, podListRule())
	releaseRefresh := make(chan struct{})

	var fetchCount atomic.Int32
	fetch := func(ctx context.Context, namespace string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		if fetchCount.Add(1) > 1 {
			select {
			case <-releaseRefresh:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return status, nil
	}

	cache := NewSSRRCache("cluster-1", 2*time.Minute, 30*time.Second, fetch, clock)
	if _, err := cache.GetRules(context.Background(), "default"); err != nil {
		t.Fatalf("unexpected seed error: %v", err)
	}

	now = now.Add(2*time.Minute + 15*time.Second)
	if _, err := cache.GetRules(context.Background(), "default"); err != nil {
		t.Fatalf("unexpected stale error: %v", err)
	}
	for range 50 {
		if fetchCount.Load() >= 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if fetchCount.Load() != 2 {
		t.Fatalf("expected one background refresh to start, got %d fetches", fetchCount.Load())
	}

	for range 10 {
		if _, err := cache.GetRules(context.Background(), "default"); err != nil {
			t.Fatalf("unexpected stale error: %v", err)
		}
	}
	if fetchCount.Load() != 2 {
		t.Fatalf("expected stale hits to share one background refresh, got %d fetches", fetchCount.Load())
	}
	close(releaseRefresh)
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
	for range 10 {
		wg.Go(func() {
			cache.GetRules(context.Background(), "default")
		})
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
