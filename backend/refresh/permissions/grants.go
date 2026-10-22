package permissions

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/sync/errgroup"
)

// Grants answers a refresh generation's list and watch checks through a
// Checker and records each decision at the scope that produced it, so
// permission revalidation can tell when the generation's access changed.
type Grants struct {
	checker *Checker

	mu        sync.RWMutex
	decisions map[Grant]bool
}

// NewGrants returns grant tracking over checker, which must not be nil.
func NewGrants(checker *Checker) *Grants {
	return &Grants{checker: checker, decisions: make(map[Grant]bool)}
}

type grantScope uint8

const (
	grantDefaultScope grantScope = iota
	grantExactNamespace
)

// Grant preserves the permission evaluator and scope that originally
// produced a decision so revalidation can repeat the same check.
type Grant struct {
	group     string
	resource  string
	verb      string
	namespace string
	scope     grantScope
}

// Revalidate repeats the same permission evaluation that produced the grant.
func (g Grant) Revalidate(ctx context.Context, checker *Checker) (Decision, error) {
	if g.scope == grantExactNamespace {
		return checker.CanInNamespace(ctx, g.group, g.resource, g.verb, g.namespace)
	}
	return checker.Can(ctx, g.group, g.resource, g.verb)
}

// Identity returns the resource and verb used by the grant for diagnostics.
func (g Grant) Identity() (group, resource, verb string) {
	return g.group, g.resource, g.verb
}

// Request is one permission check to prime.
type Request struct {
	Group    string
	Resource string
	Verb     string
}

// CanListResource reports whether the current identity can list the supplied resource.
func (g *Grants) CanListResource(ctx context.Context, group, resource string) (bool, error) {
	return g.checkResourceVerb(ctx, group, resource, "list")
}

// CanWatchResource reports whether the current identity can watch the supplied resource.
func (g *Grants) CanWatchResource(ctx context.Context, group, resource string) (bool, error) {
	return g.checkResourceVerb(ctx, group, resource, "watch")
}

// CanListWatch implements the context-free ListWatchChecker used by runtime readers.
func (g *Grants) CanListWatch(group, resource string) bool {
	return g.CanListWatchWithContext(context.Background(), group, resource)
}

// CanListWatchWithContext reports whether the current identity can both list and watch the resource.
// Returns false if either permission is denied or if checking fails.
func (g *Grants) CanListWatchWithContext(ctx context.Context, group, resource string) bool {
	listAllowed, listErr := g.CanListResource(ctx, group, resource)
	if listErr != nil || !listAllowed {
		return false
	}
	watchAllowed, watchErr := g.CanWatchResource(ctx, group, resource)
	return watchErr == nil && watchAllowed
}

// CanListWatchInNamespace reports whether the current identity can both list
// and watch the resource in the exact namespace.
func (g *Grants) CanListWatchInNamespace(ctx context.Context, group, resource, namespace string) bool {
	listAllowed, listErr := g.checkResourceVerbInNamespace(ctx, group, resource, "list", namespace)
	if listErr != nil || !listAllowed {
		return false
	}
	watchAllowed, watchErr := g.checkResourceVerbInNamespace(ctx, group, resource, "watch", namespace)
	return watchErr == nil && watchAllowed
}

// Prime runs the requested checks concurrently, so later checks are served
// from the checker's cache. Independent grants are kept even if another review
// fails; caller cancellation stops the whole preflight.
func (g *Grants) Prime(ctx context.Context, requests []Request) error {
	if len(requests) == 0 {
		return nil
	}
	unique := make(map[Request]struct{}, len(requests))
	for _, req := range requests {
		unique[req] = struct{}{}
	}
	group := new(errgroup.Group)
	group.SetLimit(16)
	for req := range unique {
		group.Go(func() error {
			if err := ctx.Err(); err != nil {
				return err
			}
			_, err := g.checkResourceVerb(ctx, req.Group, req.Resource, req.Verb)
			return err
		})
	}
	return group.Wait()
}

// Snapshot returns recorded decisions at their original evaluation scopes, or
// nil when none were recorded.
func (g *Grants) Snapshot() map[Grant]bool {
	if g == nil {
		return nil
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	if len(g.decisions) == 0 {
		return nil
	}
	snapshot := make(map[Grant]bool, len(g.decisions))
	for grant, allowed := range g.decisions {
		snapshot[grant] = allowed
	}
	return snapshot
}

func (g *Grants) checkResourceVerb(ctx context.Context, group, resource, verb string) (bool, error) {
	if g == nil || g.checker == nil {
		return false, fmt.Errorf("permission checker not configured")
	}
	decision, err := g.checker.Can(ctx, group, resource, verb)
	return g.record(Grant{group: group, resource: resource, verb: verb, scope: grantDefaultScope}, decision, err)
}

func (g *Grants) checkResourceVerbInNamespace(ctx context.Context, group, resource, verb, namespace string) (bool, error) {
	if g == nil || g.checker == nil {
		return false, fmt.Errorf("permission checker not configured")
	}
	decision, err := g.checker.CanInNamespace(ctx, group, resource, verb, namespace)
	grant := Grant{group: group, resource: resource, verb: verb, namespace: namespace, scope: grantExactNamespace}
	return g.record(grant, decision, err)
}

// record keeps the first decision for each grant, denied ones included, so a
// restored grant is detected on revalidation.
func (g *Grants) record(grant Grant, decision Decision, err error) (bool, error) {
	if err != nil {
		return false, err
	}
	g.mu.Lock()
	if _, recorded := g.decisions[grant]; !recorded {
		g.decisions[grant] = decision.Allowed
	}
	g.mu.Unlock()
	return decision.Allowed, nil
}
