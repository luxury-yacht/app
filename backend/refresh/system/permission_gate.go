package system

import (
	"errors"
	"fmt"

	"k8s.io/klog/v2"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// permissionGate wraps permission checks used to register refresh domains.
type permissionGate struct {
	registry        *domain.Registry
	informerFactory *informer.Factory
	appendIssue     func(domain, resource string, errs ...error)
	logSkip         func(domain, group, resource string)
}

// listCheck models a list-only permission check for a single resource.
type listCheck struct {
	group    string
	resource string
}

// listWatchCheck models a list+watch permission check for a single resource.
type listWatchCheck struct {
	group    string
	resource string
}

// listDomainConfig describes a list-only gated domain registration.
type listDomainConfig struct {
	name          string
	issueResource string
	logGroup      string
	logResource   string
	checks        []listCheck
	allowAny      bool
	register      func(allowed map[string]bool) error
	deniedReason  string
}

// listWatchDomainConfig describes a list/watch gated domain registration with an optional list fallback.
type listWatchDomainConfig struct {
	name             string
	issueResource    string
	logGroup         string
	logResource      string
	checks           []listWatchCheck
	registerInformer func() error
	fallbackChecks   []listCheck
	registerFallback func() error
	fallbackLog      string
	deniedReason     string
}

// newPermissionGate builds a permission gate wired to the refresh registry.
func newPermissionGate(
	registry *domain.Registry,
	informerFactory *informer.Factory,
	appendIssue func(domain, resource string, errs ...error),
	logSkip func(domain, group, resource string),
) *permissionGate {
	return &permissionGate{
		registry:        registry,
		informerFactory: informerFactory,
		appendIssue:     appendIssue,
		logSkip:         logSkip,
	}
}

type listCheckResult struct {
	check   listCheck
	allowed bool
	err     error
}

type listWatchCheckResult struct {
	check        listWatchCheck
	listAllowed  bool
	watchAllowed bool
	err          error
}

func (g *permissionGate) runListChecks(checks []listCheck) []listCheckResult {
	results := make([]listCheckResult, 0, len(checks))
	for _, check := range checks {
		allowed, err := g.informerFactory.CanListResource(check.group, check.resource)
		results = append(results, listCheckResult{
			check:   check,
			allowed: allowed,
			err:     err,
		})
	}
	return results
}

func (g *permissionGate) runListWatchChecks(checks []listWatchCheck) []listWatchCheckResult {
	results := make([]listWatchCheckResult, 0, len(checks))
	for _, check := range checks {
		listAllowed, listErr := g.informerFactory.CanListResource(check.group, check.resource)
		watchAllowed, watchErr := g.informerFactory.CanWatchResource(check.group, check.resource)
		results = append(results, listWatchCheckResult{
			check:        check,
			listAllowed:  listAllowed,
			watchAllowed: watchAllowed,
			err:          errors.Join(listErr, watchErr),
		})
	}
	return results
}

func (g *permissionGate) listErrors(results []listCheckResult) []error {
	errs := make([]error, 0, len(results))
	for _, result := range results {
		if result.err != nil {
			errs = append(errs, result.err)
		}
	}
	return errs
}

func (g *permissionGate) listWatchErrors(results []listWatchCheckResult) []error {
	errs := make([]error, 0, len(results))
	for _, result := range results {
		if result.err != nil {
			errs = append(errs, result.err)
		}
	}
	return errs
}

func (g *permissionGate) listWatchErrFor(results []listWatchCheckResult, group, resource string) error {
	for _, result := range results {
		if result.check.group == group && result.check.resource == resource {
			return result.err
		}
	}
	return nil
}

func (g *permissionGate) allListAllowed(results []listCheckResult) bool {
	for _, result := range results {
		if !result.allowed {
			return false
		}
	}
	return true
}

func (g *permissionGate) anyListAllowed(results []listCheckResult) bool {
	for _, result := range results {
		if result.allowed {
			return true
		}
	}
	return false
}

func (g *permissionGate) allListWatchAllowed(results []listWatchCheckResult) (bool, bool) {
	listOK := true
	watchOK := true
	for _, result := range results {
		if !result.listAllowed {
			listOK = false
		}
		if !result.watchAllowed {
			watchOK = false
		}
	}
	return listOK, watchOK
}

func (g *permissionGate) listAllowedByKey(results []listCheckResult) map[string]bool {
	allowed := make(map[string]bool, len(results))
	for _, result := range results {
		group := result.check.group
		if group == "" {
			group = "core"
		}
		key := fmt.Sprintf("%s/%s", group, result.check.resource)
		allowed[key] = result.allowed
	}
	return allowed
}

// registerListDomain enforces list-only permissions before registering a domain.
func (g *permissionGate) registerListDomain(cfg listDomainConfig) error {
	results := g.runListChecks(cfg.checks)
	errs := g.listErrors(results)
	g.appendIssue(cfg.name, cfg.issueResource, errs...)

	allowed := g.allListAllowed(results)
	if cfg.allowAny {
		allowed = g.anyListAllowed(results)
	}

	if len(errs) == 0 && allowed {
		return cfg.register(g.listAllowedByKey(results))
	}

	g.logSkip(cfg.name, cfg.logGroup, cfg.logResource)
	return snapshot.RegisterPermissionDeniedDomain(g.registry, cfg.name, cfg.deniedReason)
}

// registerListWatchDomain enforces list+watch permissions before registering a domain.
func (g *permissionGate) registerListWatchDomain(cfg listWatchDomainConfig) error {
	results := g.runListWatchChecks(cfg.checks)
	errs := g.listWatchErrors(results)
	g.appendIssue(cfg.name, cfg.issueResource, errs...)

	listOK, watchOK := g.allListWatchAllowed(results)
	if len(errs) == 0 && listOK && watchOK {
		return cfg.registerInformer()
	}

	if cfg.registerFallback != nil && len(cfg.fallbackChecks) > 0 {
		fallbackResults := g.runListChecks(cfg.fallbackChecks)
		fallbackErrs := g.listErrors(fallbackResults)
		fallbackWatchErr := false
		for _, fallbackCheck := range cfg.fallbackChecks {
			if err := g.listWatchErrFor(results, fallbackCheck.group, fallbackCheck.resource); err != nil {
				fallbackWatchErr = true
				break
			}
		}
		if len(fallbackErrs) == 0 && !fallbackWatchErr && g.allListAllowed(fallbackResults) {
			if cfg.fallbackLog != "" {
				klog.V(2).Info(cfg.fallbackLog)
			}
			return cfg.registerFallback()
		}
	}

	g.logSkip(cfg.name, cfg.logGroup, cfg.logResource)
	return snapshot.RegisterPermissionDeniedDomain(g.registry, cfg.name, cfg.deniedReason)
}
