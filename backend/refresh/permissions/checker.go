package permissions

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"golang.org/x/sync/singleflight"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/k8sretry"
)

// ListWatchChecker gates informer access based on RBAC permissions.
// Implementations return true only when the identity can both list and watch the resource.
type ListWatchChecker interface {
	CanListWatch(group, resource string) bool
}

// AccessReviewFunc issues a SelfSubjectAccessReview for the specified resource
// verb. namespace scopes the review to one namespace; empty means
// cluster-wide (exactly the pre-scope behavior).
type AccessReviewFunc func(ctx context.Context, group, resource, verb, namespace string) (bool, error)

// DecisionSource describes how a permission decision was obtained.
type DecisionSource string

const (
	DecisionSourceCache    DecisionSource = "cache"
	DecisionSourceFresh    DecisionSource = "fresh"
	DecisionSourceFallback DecisionSource = "fallback"
	DecisionSourceStale    DecisionSource = "stale"
)

// Decision reports the result of a permission check and how it was derived.
type Decision struct {
	Allowed   bool
	Source    DecisionSource
	CachedAt  time.Time
	ExpiresAt time.Time
}

type cacheEntry struct {
	allowed   bool
	cachedAt  time.Time
	expiresAt time.Time
}

// Checker performs SSAR requests and caches the results per cluster selection.
type Checker struct {
	clusterID  string
	ttl        time.Duration
	staleGrace time.Duration // extra window beyond TTL where stale results are served
	review     AccessReviewFunc
	now        func() time.Time

	mu      sync.RWMutex
	cache   map[string]cacheEntry
	sfGroup singleflight.Group // deduplicates concurrent SSAR calls for the same key

	// scope + scopeApplies configure the cluster's namespace scope
	// (docs/plans/namespace-scope.md); see SetScope.
	scope        []string
	scopeApplies func(group, resource string) bool
}

// NewChecker constructs a permission checker backed by the Kubernetes client.
func NewChecker(client kubernetes.Interface, clusterID string, ttl time.Duration) *Checker {
	if ttl <= 0 {
		ttl = config.PermissionCacheTTL
	}

	review := func(ctx context.Context, group, resource, verb, namespace string) (bool, error) {
		if client == nil {
			return false, fmt.Errorf("kubernetes client not initialized")
		}
		ctx = ensureContext(ctx)
		if _, hasDeadline := ctx.Deadline(); !hasDeadline {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, config.PermissionCheckTimeout)
			defer cancel()
		}

		var resp *authorizationv1.SelfSubjectAccessReview
		err := k8sretry.Do(ctx, permissionReviewRetryPolicy(), func(callCtx context.Context) error {
			req := &authorizationv1.SelfSubjectAccessReview{
				Spec: authorizationv1.SelfSubjectAccessReviewSpec{
					ResourceAttributes: &authorizationv1.ResourceAttributes{
						Group:     group,
						Resource:  resource,
						Verb:      verb,
						Namespace: namespace,
					},
				},
			}
			var err error
			resp, err = client.AuthorizationV1().SelfSubjectAccessReviews().Create(callCtx, req, metav1.CreateOptions{})
			return err
		})
		if err != nil {
			return false, err
		}
		if resp == nil {
			return false, fmt.Errorf("permission review returned no response")
		}
		return resp.Status.Allowed, nil
	}

	return NewCheckerWithReview(clusterID, ttl, review)
}

func permissionReviewRetryPolicy() k8sretry.Policy {
	return k8sretry.Policy{
		MaxAttempts:    config.PermissionReviewRetryMaxAttempts,
		InitialBackoff: config.PermissionReviewRetryInitialBackoff,
		MaxBackoff:     config.PermissionReviewRetryMaxBackoff,
	}
}

// NewCheckerWithReview constructs a checker with a custom review function.
func NewCheckerWithReview(clusterID string, ttl time.Duration, review AccessReviewFunc) *Checker {
	if ttl <= 0 {
		ttl = config.PermissionCacheTTL
	}
	if review == nil {
		review = func(context.Context, string, string, string, string) (bool, error) {
			return false, fmt.Errorf("permission review function not configured")
		}
	}
	return &Checker{
		clusterID:  strings.TrimSpace(clusterID),
		ttl:        ttl,
		staleGrace: config.PermissionCacheStaleGracePeriod,
		review:     review,
		now:        time.Now,
		cache:      make(map[string]cacheEntry),
	}
}

// SetScope configures the cluster's namespace scope
// (docs/plans/namespace-scope.md). scopeApplies reports whether a resource's
// DATA PATH is namespace-scoped in this build — Can fans out over the scope
// only for those resources; every other resource keeps cluster-wide checks so
// a domain can never register against a cluster-wide source it cannot read.
// Call before the checker is shared across goroutines (subsystem build time).
func (c *Checker) SetScope(namespaces []string, scopeApplies func(group, resource string) bool) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.scope = append([]string(nil), namespaces...)
	c.scopeApplies = scopeApplies
	c.mu.Unlock()
}

// scopeFor returns the namespaces Can must fan out over for the resource:
// nil for a single cluster-wide check.
func (c *Checker) scopeFor(group, resource string) []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.scope) == 0 || c.scopeApplies == nil || !c.scopeApplies(group, resource) {
		return nil
	}
	return c.scope
}

// Can checks a resource verb and caches the decision per cluster selection.
// Under a namespace scope, resources whose data path is scoped are allowed
// when ANY configured namespace allows the verb; the per-namespace results
// are cached individually so per-namespace consumers reuse them.
func (c *Checker) Can(ctx context.Context, group, resource, verb string) (Decision, error) {
	if c == nil {
		return Decision{}, fmt.Errorf("permission checker not initialized")
	}
	scope := c.scopeFor(group, resource)
	if len(scope) == 0 {
		return c.canInNamespace(ctx, group, resource, verb, "")
	}

	type outcome struct {
		decision Decision
		err      error
	}
	outcomes := make([]outcome, len(scope))
	var wg sync.WaitGroup
	for i, namespace := range scope {
		wg.Add(1)
		go func(i int, namespace string) {
			defer wg.Done()
			decision, err := c.canInNamespace(ctx, group, resource, verb, namespace)
			outcomes[i] = outcome{decision: decision, err: err}
		}(i, namespace)
	}
	wg.Wait()

	var firstErr error
	denied := Decision{}
	deniedSeen := false
	for _, o := range outcomes {
		if o.err != nil {
			if firstErr == nil {
				firstErr = o.err
			}
			continue
		}
		if o.decision.Allowed {
			return o.decision, nil
		}
		denied = o.decision
		deniedSeen = true
	}
	if deniedSeen {
		return denied, nil
	}
	return Decision{}, firstErr
}

// CanInNamespace checks a resource verb in one namespace (empty =
// cluster-wide), bypassing the scope fan-out. Per-namespace surfaces use it
// directly; results share Can's cache.
func (c *Checker) CanInNamespace(ctx context.Context, group, resource, verb, namespace string) (Decision, error) {
	if c == nil {
		return Decision{}, fmt.Errorf("permission checker not initialized")
	}
	return c.canInNamespace(ctx, group, resource, verb, namespace)
}

// CanClusterWide checks a resource verb cluster-wide regardless of any
// configured scope. For callers whose DATA SOURCE is cluster-wide (e.g. the
// helm-storage informer factory) — their gate must match their source.
func (c *Checker) CanClusterWide(ctx context.Context, group, resource, verb string) (Decision, error) {
	if c == nil {
		return Decision{}, fmt.Errorf("permission checker not initialized")
	}
	return c.canInNamespace(ctx, group, resource, verb, "")
}

func (c *Checker) canInNamespace(ctx context.Context, group, resource, verb, namespace string) (Decision, error) {
	key, err := c.cacheKey(group, resource, verb, namespace)
	if err != nil {
		return Decision{}, err
	}

	now := c.now()
	entry, ok := c.getEntry(key)
	if ok && !now.After(entry.expiresAt) {
		return Decision{
			Allowed:   entry.allowed,
			Source:    DecisionSourceCache,
			CachedAt:  entry.cachedAt,
			ExpiresAt: entry.expiresAt,
		}, nil
	}

	// Stale-while-revalidate: if the entry is expired but within the grace window,
	// return the stale value immediately and trigger a background refresh.
	if ok && c.staleGrace > 0 && !now.After(entry.expiresAt.Add(c.staleGrace)) {
		c.triggerBackgroundRefresh(ctx, key, group, resource, verb, namespace)
		return Decision{
			Allowed:   entry.allowed,
			Source:    DecisionSourceStale,
			CachedAt:  entry.cachedAt,
			ExpiresAt: entry.expiresAt,
		}, nil
	}

	// Use singleflight to deduplicate concurrent SSAR calls for the same cache key.
	type sfResult struct {
		allowed bool
		err     error
	}
	val, _, _ := c.sfGroup.Do(key, func() (interface{}, error) {
		allowed, err := c.review(ctx, strings.TrimSpace(group), strings.TrimSpace(resource), strings.TrimSpace(verb), strings.TrimSpace(namespace))
		return sfResult{allowed: allowed, err: err}, nil
	})
	result := val.(sfResult)
	allowed, err := result.allowed, result.err

	if err == nil {
		entry = c.storeEntry(key, allowed, now)
		return Decision{
			Allowed:   allowed,
			Source:    DecisionSourceFresh,
			CachedAt:  entry.cachedAt,
			ExpiresAt: entry.expiresAt,
		}, nil
	}

	if ok && isTransientPermissionError(err) {
		return Decision{
			Allowed:   entry.allowed,
			Source:    DecisionSourceFallback,
			CachedAt:  entry.cachedAt,
			ExpiresAt: entry.expiresAt,
		}, nil
	}

	return Decision{}, err
}

// triggerBackgroundRefresh fires an async SSAR call (deduplicated via singleflight)
// to refresh an expired cache entry without blocking the caller.
func (c *Checker) triggerBackgroundRefresh(ctx context.Context, key, group, resource, verb, namespace string) {
	// Use a detached context so the background call outlives the request.
	bgCtx := context.Background()
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		var cancel context.CancelFunc
		bgCtx, cancel = context.WithTimeout(bgCtx, config.PermissionCheckTimeout)
		// cancel is invoked after the goroutine completes.
		go func() {
			defer cancel()
			c.doBackgroundRefresh(bgCtx, key, group, resource, verb, namespace)
		}()
		return
	}
	go c.doBackgroundRefresh(bgCtx, key, group, resource, verb, namespace)
}

// doBackgroundRefresh executes the SSAR call and stores the result via singleflight.
func (c *Checker) doBackgroundRefresh(ctx context.Context, key, group, resource, verb, namespace string) {
	type sfResult struct {
		allowed bool
		err     error
	}
	val, _, _ := c.sfGroup.Do(key, func() (interface{}, error) {
		allowed, err := c.review(ctx, strings.TrimSpace(group), strings.TrimSpace(resource), strings.TrimSpace(verb), strings.TrimSpace(namespace))
		return sfResult{allowed: allowed, err: err}, nil
	})
	result := val.(sfResult)
	if result.err == nil {
		c.storeEntry(key, result.allowed, c.now())
	}
}

func (c *Checker) cacheKey(group, resource, verb, namespace string) (string, error) {
	resource = strings.TrimSpace(resource)
	verb = strings.TrimSpace(verb)
	group = strings.TrimSpace(group)
	namespace = strings.TrimSpace(namespace)
	if resource == "" || verb == "" {
		return "", fmt.Errorf("permission key requires resource and verb")
	}
	key := fmt.Sprintf("%s/%s/%s", group, resource, verb)
	if namespace != "" {
		// Cluster-wide checks keep the pre-scope key shape.
		key = fmt.Sprintf("%s|ns=%s", key, namespace)
	}
	if c.clusterID == "" {
		return key, nil
	}
	return fmt.Sprintf("%s|%s", c.clusterID, key), nil
}

func (c *Checker) getEntry(key string) (cacheEntry, bool) {
	c.mu.RLock()
	entry, ok := c.cache[key]
	c.mu.RUnlock()
	return entry, ok
}

func (c *Checker) storeEntry(key string, allowed bool, now time.Time) cacheEntry {
	entry := cacheEntry{
		allowed:   allowed,
		cachedAt:  now,
		expiresAt: now.Add(c.ttl),
	}
	c.mu.Lock()
	c.cache[key] = entry
	c.mu.Unlock()
	return entry
}

func ensureContext(ctx context.Context) context.Context {
	if ctx != nil {
		return ctx
	}
	return context.Background()
}

// CanListWatch reports whether the identity can both list and watch the resource.
func (c *Checker) CanListWatch(group, resource string) bool {
	if c == nil {
		return false
	}
	listDec, err := c.Can(context.Background(), group, resource, "list")
	if err != nil || !listDec.Allowed {
		return false
	}
	watchDec, err := c.Can(context.Background(), group, resource, "watch")
	if err != nil || !watchDec.Allowed {
		return false
	}
	return true
}

func isTransientPermissionError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	return k8sretry.IsRetryable(err)
}
