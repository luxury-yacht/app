package permissions

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"golang.org/x/sync/singleflight"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// ListWatchChecker gates informer access based on RBAC permissions.
// Implementations return true only when the identity can both list and watch the resource.
type ListWatchChecker interface {
	CanListWatch(group, resource string) bool
}

// AccessReviewFunc issues a SelfSubjectAccessReview for the specified resource verb.
type AccessReviewFunc func(ctx context.Context, group, resource, verb string) (bool, error)

// DecisionSource describes how a permission decision was obtained.
type DecisionSource string

const (
	DecisionSourceCache    DecisionSource = "cache"
	DecisionSourceFresh    DecisionSource = "fresh"
	DecisionSourceFallback DecisionSource = "fallback"
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
	clusterID string
	ttl       time.Duration
	review    AccessReviewFunc
	now       func() time.Time

	mu      sync.RWMutex
	cache   map[string]cacheEntry
	sfGroup singleflight.Group // deduplicates concurrent SSAR calls for the same key
}

// NewChecker constructs a permission checker backed by the Kubernetes client.
func NewChecker(client kubernetes.Interface, clusterID string, ttl time.Duration) *Checker {
	if ttl <= 0 {
		ttl = config.PermissionCacheTTL
	}

	review := func(ctx context.Context, group, resource, verb string) (bool, error) {
		if client == nil {
			return false, fmt.Errorf("kubernetes client not initialized")
		}
		ctx = ensureContext(ctx)
		if _, hasDeadline := ctx.Deadline(); !hasDeadline {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, config.PermissionCheckTimeout)
			defer cancel()
		}

		req := &authorizationv1.SelfSubjectAccessReview{
			Spec: authorizationv1.SelfSubjectAccessReviewSpec{
				ResourceAttributes: &authorizationv1.ResourceAttributes{
					Group:    group,
					Resource: resource,
					Verb:     verb,
				},
			},
		}
		resp, err := client.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, req, metav1.CreateOptions{})
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

// NewCheckerWithReview constructs a checker with a custom review function.
func NewCheckerWithReview(clusterID string, ttl time.Duration, review AccessReviewFunc) *Checker {
	if ttl <= 0 {
		ttl = config.PermissionCacheTTL
	}
	if review == nil {
		review = func(context.Context, string, string, string) (bool, error) {
			return false, fmt.Errorf("permission review function not configured")
		}
	}
	return &Checker{
		clusterID: strings.TrimSpace(clusterID),
		ttl:       ttl,
		review:    review,
		now:       time.Now,
		cache:     make(map[string]cacheEntry),
	}
}

// Can checks a resource verb and caches the decision per cluster selection.
func (c *Checker) Can(ctx context.Context, group, resource, verb string) (Decision, error) {
	if c == nil {
		return Decision{}, fmt.Errorf("permission checker not initialized")
	}
	key, err := c.cacheKey(group, resource, verb)
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

	// Use singleflight to deduplicate concurrent SSAR calls for the same cache key.
	type sfResult struct {
		allowed bool
		err     error
	}
	val, _, _ := c.sfGroup.Do(key, func() (interface{}, error) {
		allowed, err := c.review(ctx, strings.TrimSpace(group), strings.TrimSpace(resource), strings.TrimSpace(verb))
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

func (c *Checker) cacheKey(group, resource, verb string) (string, error) {
	resource = strings.TrimSpace(resource)
	verb = strings.TrimSpace(verb)
	group = strings.TrimSpace(group)
	if resource == "" || verb == "" {
		return "", fmt.Errorf("permission key requires resource and verb")
	}
	key := fmt.Sprintf("%s/%s/%s", group, resource, verb)
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
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	if apierrors.IsTooManyRequests(err) || apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) {
		return true
	}
	return false
}
