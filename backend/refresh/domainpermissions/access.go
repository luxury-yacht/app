package domainpermissions

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// AccessDecision is the result of evaluating runtime access for a refresh domain.
type AccessDecision struct {
	Allowed      bool
	DeniedReason string
}

// RuntimeAccess evaluates refresh-domain runtime permission policies.
type RuntimeAccess struct {
	policies map[string]Policy
}

// NewRuntimeAccess returns the default runtime access adapter.
func NewRuntimeAccess() RuntimeAccess {
	return RuntimeAccess{policies: RuntimePoliciesByDomain()}
}

// Policies returns the runtime permission policies keyed by domain.
func (a RuntimeAccess) Policies() map[string]Policy {
	result := make(map[string]Policy, len(a.policies))
	for domain, policy := range a.policies {
		result[domain] = copyPolicy(policy)
	}
	return result
}

// Check evaluates whether the current identity has runtime access to a domain.
func (a RuntimeAccess) Check(ctx context.Context, domainName string, checker *permissions.Checker) (AccessDecision, error) {
	policy, ok := a.policies[domainName]
	if !ok || checker == nil || len(policy.Runtime) == 0 {
		return AccessDecision{Allowed: true}, nil
	}
	allowed, err := runtimePolicyAllows(ctx, checker, policy)
	if err != nil {
		return AccessDecision{}, err
	}
	if allowed {
		return AccessDecision{Allowed: true}, nil
	}
	return AccessDecision{
		Allowed:      false,
		DeniedReason: deniedReason(policy),
	}, nil
}

func runtimePolicyAllows(ctx context.Context, checker *permissions.Checker, policy Policy) (bool, error) {
	if policy.Mode == ModeAny {
		for _, req := range policy.Runtime {
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
	for _, req := range policy.Runtime {
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

func deniedReason(policy Policy) string {
	if reason := strings.TrimSpace(policy.Reason); reason != "" {
		return reason
	}
	return permissionResourceList(policy.Runtime)
}

func permissionResourceList(reqs []permissions.ResourceRequirement) string {
	if len(reqs) == 0 {
		return ""
	}
	parts := make([]string, 0, len(reqs))
	for _, req := range reqs {
		if req.Resource == "" {
			continue
		}
		parts = append(parts, permissions.ResourceKey(req.Group, req.Resource))
	}
	return strings.Join(parts, ",")
}
