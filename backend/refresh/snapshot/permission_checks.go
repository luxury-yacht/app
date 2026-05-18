package snapshot

import (
	"context"
	"strings"

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

func listPermission(group, resource string) permissionRequirement {
	return permissions.ListRequirement(group, resource)
}

func requireAll(reqs ...permissionRequirement) permissionCheck {
	return permissionCheck{
		requirements: reqs,
		mode:         permissionCheckAll,
		resource:     permissionResourceList(reqs),
	}
}

func requireAny(label string, reqs ...permissionRequirement) permissionCheck {
	resource := strings.TrimSpace(label)
	if resource == "" {
		resource = permissionResourceList(reqs)
	}
	return permissionCheck{
		requirements: reqs,
		mode:         permissionCheckAny,
		resource:     resource,
	}
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
	checks := defaultPermissionChecks()
	var reqs []PreflightRequirement
	seen := make(map[string]struct{})
	for _, check := range checks {
		for _, req := range check.requirements {
			key := permissions.RequirementKey(req)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			reqs = append(reqs, PreflightRequirement{
				Group:    req.Group,
				Resource: req.Resource,
				Verb:     req.Verb,
			})
		}
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
	return map[string]permissionCheck{
		"namespaces": requireAll(
			listPermission("", "namespaces"),
		),
		namespaceWorkloadsDomainName: requireAny(
			"workload resources",
			listPermission("", "pods"),
			listPermission("apps", "deployments"),
			listPermission("apps", "statefulsets"),
			listPermission("apps", "daemonsets"),
			listPermission("batch", "jobs"),
			listPermission("batch", "cronjobs"),
		),
		namespaceConfigDomainName: requireAny(
			"core/configmaps,secrets",
			listPermission("", "configmaps"),
			listPermission("", "secrets"),
		),
		namespaceNetworkDomainName: requireAny(
			"network resources",
			listPermission("", "services"),
			listPermission("discovery.k8s.io", "endpointslices"),
			listPermission("networking.k8s.io", "ingresses"),
			listPermission("networking.k8s.io", "networkpolicies"),
			listPermission("gateway.networking.k8s.io", "gateways"),
			listPermission("gateway.networking.k8s.io", "httproutes"),
			listPermission("gateway.networking.k8s.io", "grpcroutes"),
			listPermission("gateway.networking.k8s.io", "tlsroutes"),
			listPermission("gateway.networking.k8s.io", "listenersets"),
			listPermission("gateway.networking.k8s.io", "referencegrants"),
			listPermission("gateway.networking.k8s.io", "backendtlspolicies"),
		),
		namespaceStorageDomainName: requireAll(
			listPermission("", "persistentvolumeclaims"),
		),
		namespaceAutoscalingDomainName: requireAll(
			listPermission("autoscaling", "horizontalpodautoscalers"),
		),
		namespaceQuotasDomainName: requireAny(
			"quota resources",
			listPermission("", "resourcequotas"),
			listPermission("", "limitranges"),
			listPermission("policy", "poddisruptionbudgets"),
		),
		namespaceRBACDomainName: requireAny(
			"rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
			listPermission("rbac.authorization.k8s.io", "roles"),
			listPermission("rbac.authorization.k8s.io", "rolebindings"),
			listPermission("", "serviceaccounts"),
		),
		namespaceCustomDomainName: requireAll(
			listPermission("apiextensions.k8s.io", "customresourcedefinitions"),
		),
		namespaceHelmDomainName: requireAll(
			listPermission("", "secrets"),
		),
		namespaceEventsDomainName: requireAll(
			listPermission("", "events"),
		),
		podDomainName: requireAll(
			listPermission("", "pods"),
		),
		"nodes": requireAll(
			listPermission("", "nodes"),
		),
		clusterOverviewDomainName: requireAll(
			listPermission("", "nodes"),
		),
		clusterRBACDomainName: requireAny(
			"rbac.authorization.k8s.io",
			listPermission("rbac.authorization.k8s.io", "clusterroles"),
			listPermission("rbac.authorization.k8s.io", "clusterrolebindings"),
		),
		clusterStorageDomainName: requireAll(
			listPermission("", "persistentvolumes"),
		),
		clusterConfigDomainName: requireAny(
			"cluster configuration resources",
			listPermission("storage.k8s.io", "storageclasses"),
			listPermission("networking.k8s.io", "ingressclasses"),
			listPermission("gateway.networking.k8s.io", "gatewayclasses"),
			listPermission("admissionregistration.k8s.io", "validatingwebhookconfigurations"),
			listPermission("admissionregistration.k8s.io", "mutatingwebhookconfigurations"),
		),
		clusterCRDDomainName: requireAll(
			listPermission("apiextensions.k8s.io", "customresourcedefinitions"),
		),
		clusterCustomDomainName: requireAll(
			listPermission("apiextensions.k8s.io", "customresourcedefinitions"),
		),
		clusterEventsDomainName: requireAll(
			listPermission("", "events"),
		),
		objectEventsDomain: requireAll(
			listPermission("", "events"),
		),
		objectMapDomain: requireAny(
			"object map resources",
			listPermission("", "pods"),
			listPermission("", "services"),
			listPermission("discovery.k8s.io", "endpointslices"),
			listPermission("", "persistentvolumeclaims"),
			listPermission("", "persistentvolumes"),
			listPermission("storage.k8s.io", "storageclasses"),
			listPermission("", "configmaps"),
			listPermission("", "secrets"),
			listPermission("", "serviceaccounts"),
			listPermission("", "nodes"),
			listPermission("apps", "deployments"),
			listPermission("apps", "replicasets"),
			listPermission("apps", "statefulsets"),
			listPermission("apps", "daemonsets"),
			listPermission("batch", "jobs"),
			listPermission("batch", "cronjobs"),
			listPermission("autoscaling", "horizontalpodautoscalers"),
			listPermission("networking.k8s.io", "ingresses"),
			listPermission("networking.k8s.io", "ingressclasses"),
			listPermission("gateway.networking.k8s.io", "gatewayclasses"),
			listPermission("gateway.networking.k8s.io", "gateways"),
			listPermission("gateway.networking.k8s.io", "httproutes"),
			listPermission("gateway.networking.k8s.io", "grpcroutes"),
			listPermission("gateway.networking.k8s.io", "tlsroutes"),
			listPermission("gateway.networking.k8s.io", "listenersets"),
			listPermission("gateway.networking.k8s.io", "referencegrants"),
			listPermission("gateway.networking.k8s.io", "backendtlspolicies"),
		),
	}
}
