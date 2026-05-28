package snapshot

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// Per-request permission checks prevent cached snapshots from outliving RBAC changes.
type permissionRequirement = permissions.ResourceRequirement

type permissionCheckMode int

const (
	permissionCheckAll permissionCheckMode = iota
	permissionCheckAny
)

type permissionCheck struct {
	requirements []permissionRequirement
	mode         permissionCheckMode
	resource     string
}

// allows reports whether the runtime permission checker satisfies this domain's requirements.
func (p permissionCheck) allows(ctx context.Context, checker *permissions.Checker) (bool, error) {
	if checker == nil || len(p.requirements) == 0 {
		return true, nil
	}
	if p.mode == permissionCheckAny {
		for _, req := range p.requirements {
			decision, err := checker.Can(ctx, req.Group, req.Resource, req.Verb)
			if err != nil {
				return false, err
			}
			if decision.Allowed {
				return true, nil
			}
		}
		return false, nil
	}
	for _, req := range p.requirements {
		decision, err := checker.Can(ctx, req.Group, req.Resource, req.Verb)
		if err != nil {
			return false, err
		}
		if !decision.Allowed {
			return false, nil
		}
	}
	return true, nil
}

func permissionResourceList(reqs []permissionRequirement) string {
	if len(reqs) == 0 {
		return ""
	}
	parts := make([]string, 0, len(reqs))
	for _, req := range reqs {
		if req.Resource == "" {
			continue
		}
		parts = append(parts, permissionResourceLabel(req))
	}
	return strings.Join(parts, ",")
}

func permissionResourceLabel(req permissionRequirement) string {
	return permissions.ResourceKey(req.Group, req.Resource)
}

// PreflightRequirement describes a single permission to prime during startup.
type PreflightRequirement struct {
	Group    string
	Resource string
	Verb     string
}

// DomainPermissionRequirement describes the runtime permission contract for a
// refresh domain.
type DomainPermissionRequirement struct {
	Domain       string
	Mode         string
	Requirements []permissions.ResourceRequirement
}

// CheckDomainPermission checks whether the runtime permission requirements for the given
// domain are satisfied. It uses defaultPermissionChecks() as the single source of truth.
// Returns (true, "", nil) if allowed or if no check is defined for the domain.
// Returns (false, reason, nil) if denied.
// Returns (false, "", err) if the check itself fails.
func CheckDomainPermission(ctx context.Context, domainName string, checker *permissions.Checker) (bool, string, error) {
	checks := defaultPermissionChecks()
	check, ok := checks[domainName]
	if !ok {
		return true, "", nil
	}
	allowed, err := check.allows(ctx, checker)
	if err != nil {
		return false, "", err
	}
	if !allowed {
		return false, check.resource, nil
	}
	return true, "", nil
}

// RuntimePreflightRequirements returns all permission requirements from defaultPermissionChecks
// for cache priming at startup. This ensures every runtime permission check is pre-warmed.
func RuntimePreflightRequirements() []PreflightRequirement {
	requirements := domainpermissions.PreflightRequirements()
	reqs := make([]PreflightRequirement, 0, len(requirements))
	for _, req := range requirements {
		reqs = append(reqs, PreflightRequirement{
			Group:    req.Group,
			Resource: req.Resource,
			Verb:     req.Verb,
		})
	}
	return reqs
}

// RuntimePermissionRequirements returns the runtime permission contract keyed
// by refresh domain. The returned slices are copies so tests and callers cannot
// mutate the package-level contract.
func RuntimePermissionRequirements() map[string]DomainPermissionRequirement {
	checks := defaultPermissionChecks()
	result := make(map[string]DomainPermissionRequirement, len(checks))
	for domain, check := range checks {
		requirements := append([]permissions.ResourceRequirement(nil), check.requirements...)
		mode := "all"
		if check.mode == permissionCheckAny {
			mode = "any"
		}
		result[domain] = DomainPermissionRequirement{
			Domain:       domain,
			Mode:         mode,
			Requirements: requirements,
		}
	}
	return result
}

// defaultPermissionChecks maps snapshot domains to list permissions for per-request SSAR gating.
func defaultPermissionChecks() map[string]permissionCheck {
	policies := domainpermissions.RuntimePoliciesByDomain()
	checks := make(map[string]permissionCheck, len(policies))
	for domain, policy := range policies {
		mode := permissionCheckAll
		if policy.Mode == domainpermissions.ModeAny {
			mode = permissionCheckAny
		}
		resource := strings.TrimSpace(policy.Reason)
		if resource == "" {
			resource = permissionResourceList(policy.Runtime)
		}
		checks[domain] = permissionCheck{
			requirements: append([]permissionRequirement(nil), policy.Runtime...),
			mode:         mode,
			resource:     resource,
		}
	}
	return checks
}
