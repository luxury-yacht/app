package snapshot

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// Per-request permission checks prevent cached snapshots from outliving RBAC changes.
type permissionRequirement struct {
	group    string
	resource string
	verb     string
}

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
	return permissionRequirement{
		group:    group,
		resource: resource,
		verb:     "list",
	}
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
			decision, err := checker.Can(ctx, req.group, req.resource, req.verb)
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
		decision, err := checker.Can(ctx, req.group, req.resource, req.verb)
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
		if req.resource == "" {
			continue
		}
		parts = append(parts, permissionResourceLabel(req))
	}
	return strings.Join(parts, ",")
}

func permissionResourceLabel(req permissionRequirement) string {
	group := strings.TrimSpace(req.group)
	if group == "" {
		group = "core"
	}
	return fmt.Sprintf("%s/%s", group, req.resource)
}

// defaultPermissionChecks maps snapshot domains to list permissions for per-request SSAR gating.
func defaultPermissionChecks() map[string]permissionCheck {
	return map[string]permissionCheck{
		"namespaces": requireAll(
			listPermission("", "namespaces"),
		),
		namespaceWorkloadsDomainName: requireAll(
			listPermission("", "pods"),
			listPermission("apps", "deployments"),
			listPermission("apps", "statefulsets"),
			listPermission("apps", "daemonsets"),
			listPermission("batch", "jobs"),
			listPermission("batch", "cronjobs"),
		),
		namespaceConfigDomainName: requireAll(
			listPermission("", "configmaps"),
			listPermission("", "secrets"),
		),
		namespaceNetworkDomainName: requireAll(
			listPermission("", "services"),
			listPermission("discovery.k8s.io", "endpointslices"),
			listPermission("networking.k8s.io", "ingresses"),
			listPermission("networking.k8s.io", "networkpolicies"),
		),
		namespaceStorageDomainName: requireAll(
			listPermission("", "persistentvolumeclaims"),
		),
		namespaceAutoscalingDomainName: requireAll(
			listPermission("autoscaling", "horizontalpodautoscalers"),
		),
		namespaceQuotasDomainName: requireAll(
			listPermission("", "resourcequotas"),
			listPermission("", "limitranges"),
			listPermission("policy", "poddisruptionbudgets"),
		),
		namespaceRBACDomainName: requireAll(
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
			listPermission("", "namespaces"),
		),
		clusterRBACDomainName: requireAll(
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
	}
}
