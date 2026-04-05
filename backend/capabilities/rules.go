/*
 * backend/capabilities/rules.go
 *
 * SSRR cache with four-state TTL+staleGrace policy and singleflight
 * deduplication, matching the existing SSAR checker pattern in
 * backend/refresh/permissions/checker.go.
 */

package capabilities

import (
	"context"
	"slices"
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

	val, _, _ := c.sfGroup.Do(namespace, func() (any, error) {
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

// MatchRules checks whether any rule in the list grants access for the
// given apiGroup, resource, verb, subresource, and name. Follows the
// Kubernetes RBAC ResourceMatches semantics: exact match, "*" (all),
// and "*/subresource". The form "resource/*" is NOT supported (not
// valid K8s RBAC).
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
	if name == "" {
		return false
	}
	return slices.Contains(ruleNames, name)
}
