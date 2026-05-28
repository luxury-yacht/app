package domainpermissions

import (
	"context"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

type allowedResourcesContextKey struct{}

// AccessDecision is the result of evaluating runtime access for a refresh domain.
type AccessDecision struct {
	Allowed          bool
	DeniedReason     string
	AllowedResources AllowedResources
}

// AllowedResources reports which resources passed registration-time access checks.
type AllowedResources map[string]bool

// Allows reports whether a resource was allowed, using the same canonical key
// format as Policy requirements.
func (a AllowedResources) Allows(group, resource string) bool {
	return a[permissions.ResourceKey(group, resource)]
}

// WithAllowedResources stores the per-resource runtime permission decision for
// one domain on the request context so snapshot builders can omit revoked
// resource families without re-running their own SSAR checks.
func WithAllowedResources(ctx context.Context, domain string, allowed AllowedResources) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	domain = strings.TrimSpace(domain)
	if domain == "" || len(allowed) == 0 {
		return ctx
	}
	existing, _ := ctx.Value(allowedResourcesContextKey{}).(map[string]AllowedResources)
	next := make(map[string]AllowedResources, len(existing)+1)
	for key, resources := range existing {
		next[key] = copyAllowedResources(resources)
	}
	next[domain] = copyAllowedResources(allowed)
	return context.WithValue(ctx, allowedResourcesContextKey{}, next)
}

// AllowedResourcesFromContext returns the runtime permission map for a domain
// when the snapshot service has evaluated one for this request.
func AllowedResourcesFromContext(ctx context.Context, domain string) (AllowedResources, bool) {
	if ctx == nil {
		return nil, false
	}
	byDomain, _ := ctx.Value(allowedResourcesContextKey{}).(map[string]AllowedResources)
	allowed, ok := byDomain[strings.TrimSpace(domain)]
	if !ok {
		return nil, false
	}
	return copyAllowedResources(allowed), true
}

// AllowedResourcesFingerprint returns a deterministic cache-key suffix for a
// per-resource runtime permission map.
func AllowedResourcesFingerprint(allowed AllowedResources) string {
	if len(allowed) == 0 {
		return ""
	}
	keys := make([]string, 0, len(allowed))
	for key := range allowed {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		value := "0"
		if allowed[key] {
			value = "1"
		}
		parts = append(parts, key+"="+value)
	}
	return strings.Join(parts, ",")
}

func copyAllowedResources(src AllowedResources) AllowedResources {
	if len(src) == 0 {
		return nil
	}
	out := make(AllowedResources, len(src))
	for key, allowed := range src {
		out[key] = allowed
	}
	return out
}

// RegistrationAccessPlan is the registration-time view of a domain policy.
type RegistrationAccessPlan struct {
	Domain       string
	Mode         Mode
	DeniedReason string
	Requirements []permissions.ResourceRequirement
}

// AllowAny reports whether the plan allows partial registration when any
// requirement is permitted.
func (p RegistrationAccessPlan) AllowAny() bool {
	return p.Mode == ModeAny
}

// RuntimeAccess evaluates refresh-domain runtime permission policies.
type RuntimeAccess struct {
	policies map[string]Policy
}

// NewRuntimeAccess returns the default runtime access adapter.
func NewRuntimeAccess() RuntimeAccess {
	return RuntimeAccess{policies: RuntimePoliciesByDomain()}
}

// IsEmpty reports whether the adapter has no runtime policies configured.
func (a RuntimeAccess) IsEmpty() bool {
	return len(a.policies) == 0
}

// Policies returns the runtime permission policies keyed by domain.
func (a RuntimeAccess) Policies() map[string]Policy {
	result := make(map[string]Policy, len(a.policies))
	for domain, policy := range a.policies {
		result[domain] = copyPolicy(policy)
	}
	return result
}

// DeniedReason returns the runtime denial reason for a domain.
func (a RuntimeAccess) DeniedReason(domainName string) (string, bool) {
	policy, ok := a.policies[domainName]
	if !ok || len(policy.Runtime) == 0 {
		return "", false
	}
	return deniedReason(policy), true
}

// RegistrationPlan returns the registration-time access policy for a domain.
func (a RuntimeAccess) RegistrationPlan(domainName string) (RegistrationAccessPlan, bool) {
	policy, ok := a.policies[domainName]
	if !ok || len(policy.Runtime) == 0 {
		return RegistrationAccessPlan{}, false
	}
	return RegistrationAccessPlan{
		Domain:       policy.Domain,
		Mode:         policy.Mode,
		DeniedReason: deniedReason(policy),
		Requirements: append([]permissions.ResourceRequirement(nil), policy.Runtime...),
	}, true
}

// Check evaluates whether the current identity has runtime access to a domain.
func (a RuntimeAccess) Check(ctx context.Context, domainName string, checker *permissions.Checker) (AccessDecision, error) {
	policy, ok := a.policies[domainName]
	if !ok || checker == nil || len(policy.Runtime) == 0 {
		return AccessDecision{Allowed: true}, nil
	}
	allowedResources, allowed, err := runtimePolicyAllows(ctx, checker, policy)
	if err != nil {
		return AccessDecision{}, err
	}
	if allowed {
		return AccessDecision{Allowed: true, AllowedResources: allowedResources}, nil
	}
	return AccessDecision{
		Allowed:          false,
		DeniedReason:     deniedReason(policy),
		AllowedResources: allowedResources,
	}, nil
}

func runtimePolicyAllows(ctx context.Context, checker *permissions.Checker, policy Policy) (AllowedResources, bool, error) {
	allowedResources := make(AllowedResources, len(policy.Runtime))
	anyAllowed := false
	allAllowed := true
	for _, req := range policy.Runtime {
		decision, err := checker.Can(ctx, req.Group, req.Resource, req.Verb)
		if err != nil {
			return nil, false, err
		}
		allowedResources[permissions.ResourceKey(req.Group, req.Resource)] = decision.Allowed
		anyAllowed = anyAllowed || decision.Allowed
		if !decision.Allowed {
			allAllowed = false
		}
	}
	if policy.Mode == ModeAny {
		return allowedResources, anyAllowed, nil
	}
	return allowedResources, allAllowed, nil
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
