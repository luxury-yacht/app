package domainpermissions

import "github.com/luxury-yacht/app/backend/refresh/permissions"

// Mode describes how a domain's runtime permission requirements are evaluated.
type Mode string

const (
	ModeAll Mode = "all"
	ModeAny Mode = "any"
)

// Policy is the shared permission contract for one refresh domain. Runtime
// requirements gate snapshot reads; stream requirements describe resources that
// resource streams must be able to list and watch.
type Policy struct {
	Domain  string
	Mode    Mode
	Reason  string
	Runtime []permissions.ResourceRequirement
	Stream  []permissions.ResourceRequirement
}

// Policies returns the shared permission contract for refresh domains.
func Policies() []Policy {
	return copyPolicies(policies)
}

// RuntimePoliciesByDomain returns the runtime permission policies keyed by domain.
func RuntimePoliciesByDomain() map[string]Policy {
	result := make(map[string]Policy)
	for _, policy := range policies {
		if len(policy.Runtime) == 0 {
			continue
		}
		result[policy.Domain] = copyPolicy(policy)
	}
	return result
}

// StreamRequirementsByDomain returns the resource stream list/watch contract keyed by domain.
func StreamRequirementsByDomain() map[string][]permissions.ResourceRequirement {
	result := make(map[string][]permissions.ResourceRequirement)
	for _, policy := range policies {
		if len(policy.Stream) == 0 {
			continue
		}
		result[policy.Domain] = append([]permissions.ResourceRequirement(nil), policy.Stream...)
	}
	return result
}

// PreflightRequirements returns the full domain permission set used to warm the
// permission cache before registration and runtime checks.
func PreflightRequirements() []permissions.ResourceRequirement {
	var reqs []permissions.ResourceRequirement
	seen := make(map[string]struct{})
	add := func(req permissions.ResourceRequirement) {
		key := permissions.RequirementKey(req)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		reqs = append(reqs, req)
	}
	for _, policy := range policies {
		for _, req := range policy.Runtime {
			add(req)
		}
		for _, req := range policy.Stream {
			add(req)
		}
	}
	return reqs
}

func copyPolicies(src []Policy) []Policy {
	out := make([]Policy, 0, len(src))
	for _, policy := range src {
		out = append(out, copyPolicy(policy))
	}
	return out
}

func copyPolicy(policy Policy) Policy {
	policy.Runtime = append([]permissions.ResourceRequirement(nil), policy.Runtime...)
	policy.Stream = append([]permissions.ResourceRequirement(nil), policy.Stream...)
	return policy
}

func list(group, resource string) permissions.ResourceRequirement {
	return permissions.ListRequirement(group, resource)
}

func listWatch(group, resource string) []permissions.ResourceRequirement {
	return []permissions.ResourceRequirement{
		permissions.ListRequirement(group, resource),
		permissions.WatchRequirement(group, resource),
	}
}

func stream(reqs ...[]permissions.ResourceRequirement) []permissions.ResourceRequirement {
	var result []permissions.ResourceRequirement
	for _, group := range reqs {
		result = append(result, group...)
	}
	return result
}

var policies = []Policy{
	{
		Domain:  "namespaces",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "namespaces")},
	},
	{
		Domain: "namespace-workloads",
		Mode:   ModeAny,
		Reason: "workload resources",
		Runtime: []permissions.ResourceRequirement{
			list("", "pods"),
			list("apps", "deployments"),
			list("apps", "statefulsets"),
			list("apps", "daemonsets"),
			list("batch", "jobs"),
			list("batch", "cronjobs"),
		},
		Stream: stream(
			listWatch("", "pods"),
			listWatch("apps", "replicasets"),
			listWatch("apps", "deployments"),
			listWatch("apps", "statefulsets"),
			listWatch("apps", "daemonsets"),
			listWatch("batch", "jobs"),
			listWatch("batch", "cronjobs"),
			listWatch("autoscaling", "horizontalpodautoscalers"),
		),
	},
	{
		Domain: "namespace-config",
		Mode:   ModeAny,
		Reason: "core/configmaps,secrets",
		Runtime: []permissions.ResourceRequirement{
			list("", "configmaps"),
			list("", "secrets"),
		},
		Stream: stream(
			listWatch("", "configmaps"),
			listWatch("", "secrets"),
		),
	},
	{
		Domain: "namespace-network",
		Mode:   ModeAny,
		Reason: "network resources",
		Runtime: []permissions.ResourceRequirement{
			list("", "services"),
			list("discovery.k8s.io", "endpointslices"),
			list("networking.k8s.io", "ingresses"),
			list("networking.k8s.io", "networkpolicies"),
			list("gateway.networking.k8s.io", "gateways"),
			list("gateway.networking.k8s.io", "httproutes"),
			list("gateway.networking.k8s.io", "grpcroutes"),
			list("gateway.networking.k8s.io", "tlsroutes"),
			list("gateway.networking.k8s.io", "listenersets"),
			list("gateway.networking.k8s.io", "referencegrants"),
			list("gateway.networking.k8s.io", "backendtlspolicies"),
		},
		Stream: stream(
			listWatch("", "services"),
			listWatch("discovery.k8s.io", "endpointslices"),
			listWatch("networking.k8s.io", "ingresses"),
			listWatch("networking.k8s.io", "networkpolicies"),
			listWatch("gateway.networking.k8s.io", "gateways"),
			listWatch("gateway.networking.k8s.io", "httproutes"),
			listWatch("gateway.networking.k8s.io", "grpcroutes"),
			listWatch("gateway.networking.k8s.io", "tlsroutes"),
			listWatch("gateway.networking.k8s.io", "listenersets"),
			listWatch("gateway.networking.k8s.io", "referencegrants"),
			listWatch("gateway.networking.k8s.io", "backendtlspolicies"),
		),
	},
	{
		Domain:  "namespace-storage",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "persistentvolumeclaims")},
		Stream:  stream(listWatch("", "persistentvolumeclaims")),
	},
	{
		Domain:  "namespace-autoscaling",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("autoscaling", "horizontalpodautoscalers")},
		Stream:  stream(listWatch("autoscaling", "horizontalpodautoscalers")),
	},
	{
		Domain: "namespace-quotas",
		Mode:   ModeAny,
		Reason: "quota resources",
		Runtime: []permissions.ResourceRequirement{
			list("", "resourcequotas"),
			list("", "limitranges"),
			list("policy", "poddisruptionbudgets"),
		},
		Stream: stream(
			listWatch("", "resourcequotas"),
			listWatch("", "limitranges"),
			listWatch("policy", "poddisruptionbudgets"),
		),
	},
	{
		Domain: "namespace-rbac",
		Mode:   ModeAny,
		Reason: "rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
		Runtime: []permissions.ResourceRequirement{
			list("rbac.authorization.k8s.io", "roles"),
			list("rbac.authorization.k8s.io", "rolebindings"),
			list("", "serviceaccounts"),
		},
		Stream: stream(
			listWatch("rbac.authorization.k8s.io", "roles"),
			listWatch("rbac.authorization.k8s.io", "rolebindings"),
			listWatch("", "serviceaccounts"),
		),
	},
	{
		Domain:  "namespace-custom",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("apiextensions.k8s.io", "customresourcedefinitions")},
		Stream:  stream(listWatch("apiextensions.k8s.io", "customresourcedefinitions")),
	},
	{
		Domain:  "namespace-helm",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "secrets")},
		// Runtime Helm list operations are secret-backed in the normal Helm
		// storage path. Streams also watch ConfigMaps so configmap-backed Helm
		// release storage can trigger namespace-level resyncs when permitted.
		Stream: stream(
			listWatch("", "secrets"),
			listWatch("", "configmaps"),
		),
	},
	{
		Domain:  "namespace-events",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "events")},
	},
	{
		Domain:  "pods",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "pods")},
		Stream:  stream(listWatch("", "pods")),
	},
	{
		Domain:  "nodes",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "nodes")},
		Stream:  stream(listWatch("", "nodes")),
	},
	{
		Domain:  "cluster-overview",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "nodes")},
	},
	{
		Domain: "cluster-rbac",
		Mode:   ModeAny,
		Reason: "rbac.authorization.k8s.io",
		Runtime: []permissions.ResourceRequirement{
			list("rbac.authorization.k8s.io", "clusterroles"),
			list("rbac.authorization.k8s.io", "clusterrolebindings"),
		},
		Stream: stream(
			listWatch("rbac.authorization.k8s.io", "clusterroles"),
			listWatch("rbac.authorization.k8s.io", "clusterrolebindings"),
		),
	},
	{
		Domain:  "cluster-storage",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "persistentvolumes")},
		Stream:  stream(listWatch("", "persistentvolumes")),
	},
	{
		Domain: "cluster-config",
		Mode:   ModeAny,
		Reason: "cluster configuration resources",
		Runtime: []permissions.ResourceRequirement{
			list("storage.k8s.io", "storageclasses"),
			list("networking.k8s.io", "ingressclasses"),
			list("gateway.networking.k8s.io", "gatewayclasses"),
			list("admissionregistration.k8s.io", "validatingwebhookconfigurations"),
			list("admissionregistration.k8s.io", "mutatingwebhookconfigurations"),
		},
		Stream: stream(
			listWatch("storage.k8s.io", "storageclasses"),
			listWatch("networking.k8s.io", "ingressclasses"),
			listWatch("gateway.networking.k8s.io", "gatewayclasses"),
			listWatch("admissionregistration.k8s.io", "validatingwebhookconfigurations"),
			listWatch("admissionregistration.k8s.io", "mutatingwebhookconfigurations"),
		),
	},
	{
		Domain:  "cluster-crds",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("apiextensions.k8s.io", "customresourcedefinitions")},
		Stream:  stream(listWatch("apiextensions.k8s.io", "customresourcedefinitions")),
	},
	{
		Domain:  "cluster-custom",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("apiextensions.k8s.io", "customresourcedefinitions")},
		Stream:  stream(listWatch("apiextensions.k8s.io", "customresourcedefinitions")),
	},
	{
		Domain:  "cluster-events",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "events")},
	},
	{
		Domain:  "object-events",
		Mode:    ModeAll,
		Runtime: []permissions.ResourceRequirement{list("", "events")},
	},
	{
		Domain: "object-map",
		Mode:   ModeAny,
		Reason: "object map resources",
		Runtime: []permissions.ResourceRequirement{
			list("", "pods"),
			list("", "services"),
			list("discovery.k8s.io", "endpointslices"),
			list("", "persistentvolumeclaims"),
			list("", "persistentvolumes"),
			list("storage.k8s.io", "storageclasses"),
			list("", "configmaps"),
			list("", "secrets"),
			list("", "serviceaccounts"),
			list("", "nodes"),
			list("apps", "deployments"),
			list("apps", "replicasets"),
			list("apps", "statefulsets"),
			list("apps", "daemonsets"),
			list("batch", "jobs"),
			list("batch", "cronjobs"),
			list("autoscaling", "horizontalpodautoscalers"),
			list("networking.k8s.io", "ingresses"),
			list("networking.k8s.io", "ingressclasses"),
			list("gateway.networking.k8s.io", "gatewayclasses"),
			list("gateway.networking.k8s.io", "gateways"),
			list("gateway.networking.k8s.io", "httproutes"),
			list("gateway.networking.k8s.io", "grpcroutes"),
			list("gateway.networking.k8s.io", "tlsroutes"),
			list("gateway.networking.k8s.io", "listenersets"),
			list("gateway.networking.k8s.io", "referencegrants"),
			list("gateway.networking.k8s.io", "backendtlspolicies"),
		},
	},
}
