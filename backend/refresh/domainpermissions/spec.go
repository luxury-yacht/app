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

// Resource describes one Kubernetes resource used by a refresh domain. Group
// and Resource drive permission requirements; Version and Kind let resource
// stream projection descriptors reuse the same domain composition.
type Resource struct {
	Group    string
	Version  string
	Kind     string
	Resource string
}

type policySpec struct {
	Domain  string
	Mode    Mode
	Reason  string
	Runtime []Resource
	Stream  []Resource
}

// Policies returns the shared permission contract for refresh domains.
func Policies() []Policy {
	return copyPolicies(buildPolicies())
}

// RuntimePoliciesByDomain returns the runtime permission policies keyed by domain.
func RuntimePoliciesByDomain() map[string]Policy {
	result := make(map[string]Policy)
	for _, policy := range buildPolicies() {
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
	for _, policy := range buildPolicies() {
		if len(policy.Stream) == 0 {
			continue
		}
		result[policy.Domain] = append([]permissions.ResourceRequirement(nil), policy.Stream...)
	}
	return result
}

// RuntimeResourcesByDomain returns the runtime resource composition keyed by domain.
func RuntimeResourcesByDomain() map[string][]Resource {
	result := make(map[string][]Resource)
	for _, spec := range policySpecs {
		if len(spec.Runtime) == 0 {
			continue
		}
		result[spec.Domain] = append([]Resource(nil), spec.Runtime...)
	}
	return result
}

// StreamResourcesByDomain returns the resource stream composition keyed by domain.
func StreamResourcesByDomain() map[string][]Resource {
	result := make(map[string][]Resource)
	for _, spec := range policySpecs {
		if len(spec.Stream) == 0 {
			continue
		}
		result[spec.Domain] = append([]Resource(nil), spec.Stream...)
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
	for _, policy := range buildPolicies() {
		for _, req := range policy.Runtime {
			add(req)
		}
		for _, req := range policy.Stream {
			add(req)
		}
	}
	return reqs
}

func buildPolicies() []Policy {
	result := make([]Policy, 0, len(policySpecs))
	for _, spec := range policySpecs {
		result = append(result, Policy{
			Domain:  spec.Domain,
			Mode:    spec.Mode,
			Reason:  spec.Reason,
			Runtime: listRequirements(spec.Runtime),
			Stream:  listWatchRequirements(spec.Stream),
		})
	}
	return result
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

func listRequirements(resources []Resource) []permissions.ResourceRequirement {
	result := make([]permissions.ResourceRequirement, 0, len(resources))
	for _, resource := range resources {
		result = append(result, permissions.ListRequirement(resource.Group, resource.Resource))
	}
	return result
}

func listWatchRequirements(resources []Resource) []permissions.ResourceRequirement {
	result := make([]permissions.ResourceRequirement, 0, len(resources)*2)
	for _, resource := range resources {
		result = append(result,
			permissions.ListRequirement(resource.Group, resource.Resource),
			permissions.WatchRequirement(resource.Group, resource.Resource),
		)
	}
	return result
}

func resources(groups ...[]Resource) []Resource {
	var result []Resource
	for _, group := range groups {
		result = append(result, group...)
	}
	return result
}

func core(version, kind, resource string) Resource {
	return Resource{Version: version, Kind: kind, Resource: resource}
}

func apps(kind, resource string) Resource {
	return Resource{Group: "apps", Version: "v1", Kind: kind, Resource: resource}
}

func batch(kind, resource string) Resource {
	return Resource{Group: "batch", Version: "v1", Kind: kind, Resource: resource}
}

func autoscaling(kind, resource string) Resource {
	return Resource{Group: "autoscaling", Version: "v1", Kind: kind, Resource: resource}
}

func discovery(kind, resource string) Resource {
	return Resource{Group: "discovery.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func networking(kind, resource string) Resource {
	return Resource{Group: "networking.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func gateway(kind, resource string) Resource {
	return Resource{Group: "gateway.networking.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func rbac(kind, resource string) Resource {
	return Resource{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func policy(kind, resource string) Resource {
	return Resource{Group: "policy", Version: "v1", Kind: kind, Resource: resource}
}

func storage(kind, resource string) Resource {
	return Resource{Group: "storage.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func admission(kind, resource string) Resource {
	return Resource{Group: "admissionregistration.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func apiextensions(kind, resource string) Resource {
	return Resource{Group: "apiextensions.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

var policySpecs = []policySpec{
	{
		Domain:  "namespaces",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Namespace", "namespaces")},
	},
	{
		Domain: "namespace-workloads",
		Mode:   ModeAny,
		Reason: "workload resources",
		Runtime: []Resource{
			core("v1", "Pod", "pods"),
			apps("Deployment", "deployments"),
			apps("StatefulSet", "statefulsets"),
			apps("DaemonSet", "daemonsets"),
			batch("Job", "jobs"),
			batch("CronJob", "cronjobs"),
		},
		Stream: []Resource{
			core("v1", "Pod", "pods"),
			apps("ReplicaSet", "replicasets"),
			apps("Deployment", "deployments"),
			apps("StatefulSet", "statefulsets"),
			apps("DaemonSet", "daemonsets"),
			batch("Job", "jobs"),
			batch("CronJob", "cronjobs"),
			autoscaling("HorizontalPodAutoscaler", "horizontalpodautoscalers"),
		},
	},
	{
		Domain:  "namespace-config",
		Mode:    ModeAny,
		Reason:  "core/configmaps,secrets",
		Runtime: []Resource{core("v1", "ConfigMap", "configmaps"), core("v1", "Secret", "secrets")},
		Stream:  []Resource{core("v1", "ConfigMap", "configmaps"), core("v1", "Secret", "secrets")},
	},
	{
		Domain: "namespace-network",
		Mode:   ModeAny,
		Reason: "network resources",
		Runtime: []Resource{
			core("v1", "Service", "services"),
			discovery("EndpointSlice", "endpointslices"),
			networking("Ingress", "ingresses"),
			networking("NetworkPolicy", "networkpolicies"),
			gateway("Gateway", "gateways"),
			gateway("HTTPRoute", "httproutes"),
			gateway("GRPCRoute", "grpcroutes"),
			gateway("TLSRoute", "tlsroutes"),
			gateway("ListenerSet", "listenersets"),
			gateway("ReferenceGrant", "referencegrants"),
			gateway("BackendTLSPolicy", "backendtlspolicies"),
		},
		Stream: []Resource{
			core("v1", "Service", "services"),
			discovery("EndpointSlice", "endpointslices"),
			networking("Ingress", "ingresses"),
			networking("NetworkPolicy", "networkpolicies"),
			gateway("Gateway", "gateways"),
			gateway("HTTPRoute", "httproutes"),
			gateway("GRPCRoute", "grpcroutes"),
			gateway("TLSRoute", "tlsroutes"),
			gateway("ListenerSet", "listenersets"),
			gateway("ReferenceGrant", "referencegrants"),
			gateway("BackendTLSPolicy", "backendtlspolicies"),
		},
	},
	{
		Domain:  "namespace-storage",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "PersistentVolumeClaim", "persistentvolumeclaims")},
		Stream:  []Resource{core("v1", "PersistentVolumeClaim", "persistentvolumeclaims")},
	},
	{
		Domain:  "namespace-autoscaling",
		Mode:    ModeAll,
		Runtime: []Resource{autoscaling("HorizontalPodAutoscaler", "horizontalpodautoscalers")},
		Stream:  []Resource{autoscaling("HorizontalPodAutoscaler", "horizontalpodautoscalers")},
	},
	{
		Domain: "namespace-quotas",
		Mode:   ModeAny,
		Reason: "quota resources",
		Runtime: []Resource{
			core("v1", "ResourceQuota", "resourcequotas"),
			core("v1", "LimitRange", "limitranges"),
			policy("PodDisruptionBudget", "poddisruptionbudgets"),
		},
		Stream: []Resource{
			core("v1", "ResourceQuota", "resourcequotas"),
			core("v1", "LimitRange", "limitranges"),
			policy("PodDisruptionBudget", "poddisruptionbudgets"),
		},
	},
	{
		Domain: "namespace-rbac",
		Mode:   ModeAny,
		Reason: "rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
		Runtime: []Resource{
			rbac("Role", "roles"),
			rbac("RoleBinding", "rolebindings"),
			core("v1", "ServiceAccount", "serviceaccounts"),
		},
		Stream: []Resource{
			rbac("Role", "roles"),
			rbac("RoleBinding", "rolebindings"),
			core("v1", "ServiceAccount", "serviceaccounts"),
		},
	},
	{
		Domain:  "namespace-custom",
		Mode:    ModeAll,
		Runtime: []Resource{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
		Stream:  []Resource{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
	},
	{
		Domain:  "namespace-helm",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Secret", "secrets")},
		// Runtime Helm list operations are secret-backed in the normal Helm
		// storage path. Streams also watch ConfigMaps so configmap-backed Helm
		// release storage can trigger namespace-level resyncs when permitted.
		Stream: []Resource{core("v1", "Secret", "secrets"), core("v1", "ConfigMap", "configmaps")},
	},
	{
		Domain:  "namespace-events",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Event", "events")},
	},
	{
		Domain:  "pods",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Pod", "pods")},
		Stream:  []Resource{core("v1", "Pod", "pods")},
	},
	{
		Domain:  "nodes",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Node", "nodes")},
		Stream:  []Resource{core("v1", "Node", "nodes")},
	},
	{
		Domain:  "cluster-overview",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Node", "nodes")},
	},
	{
		Domain:  "cluster-rbac",
		Mode:    ModeAny,
		Reason:  "rbac.authorization.k8s.io",
		Runtime: []Resource{rbac("ClusterRole", "clusterroles"), rbac("ClusterRoleBinding", "clusterrolebindings")},
		Stream:  []Resource{rbac("ClusterRole", "clusterroles"), rbac("ClusterRoleBinding", "clusterrolebindings")},
	},
	{
		Domain:  "cluster-storage",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "PersistentVolume", "persistentvolumes")},
		Stream:  []Resource{core("v1", "PersistentVolume", "persistentvolumes")},
	},
	{
		Domain: "cluster-config",
		Mode:   ModeAny,
		Reason: "cluster configuration resources",
		Runtime: []Resource{
			storage("StorageClass", "storageclasses"),
			networking("IngressClass", "ingressclasses"),
			gateway("GatewayClass", "gatewayclasses"),
			admission("ValidatingWebhookConfiguration", "validatingwebhookconfigurations"),
			admission("MutatingWebhookConfiguration", "mutatingwebhookconfigurations"),
		},
		Stream: []Resource{
			storage("StorageClass", "storageclasses"),
			networking("IngressClass", "ingressclasses"),
			gateway("GatewayClass", "gatewayclasses"),
			admission("ValidatingWebhookConfiguration", "validatingwebhookconfigurations"),
			admission("MutatingWebhookConfiguration", "mutatingwebhookconfigurations"),
		},
	},
	{
		Domain:  "cluster-crds",
		Mode:    ModeAll,
		Runtime: []Resource{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
		Stream:  []Resource{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
	},
	{
		Domain:  "cluster-custom",
		Mode:    ModeAll,
		Runtime: []Resource{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
		Stream:  []Resource{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
	},
	{
		Domain:  "cluster-events",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Event", "events")},
	},
	{
		Domain:  "object-events",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Event", "events")},
	},
	{
		Domain: "object-map",
		Mode:   ModeAny,
		Reason: "object map resources",
		Runtime: resources(
			[]Resource{
				core("v1", "Pod", "pods"),
				core("v1", "Service", "services"),
				discovery("EndpointSlice", "endpointslices"),
				core("v1", "PersistentVolumeClaim", "persistentvolumeclaims"),
				core("v1", "PersistentVolume", "persistentvolumes"),
				storage("StorageClass", "storageclasses"),
				core("v1", "ConfigMap", "configmaps"),
				core("v1", "Secret", "secrets"),
				core("v1", "ServiceAccount", "serviceaccounts"),
				core("v1", "Node", "nodes"),
			},
			[]Resource{
				apps("Deployment", "deployments"),
				apps("ReplicaSet", "replicasets"),
				apps("StatefulSet", "statefulsets"),
				apps("DaemonSet", "daemonsets"),
				batch("Job", "jobs"),
				batch("CronJob", "cronjobs"),
				autoscaling("HorizontalPodAutoscaler", "horizontalpodautoscalers"),
				networking("Ingress", "ingresses"),
				networking("IngressClass", "ingressclasses"),
			},
			[]Resource{
				gateway("GatewayClass", "gatewayclasses"),
				gateway("Gateway", "gateways"),
				gateway("HTTPRoute", "httproutes"),
				gateway("GRPCRoute", "grpcroutes"),
				gateway("TLSRoute", "tlsroutes"),
				gateway("ListenerSet", "listenersets"),
				gateway("ReferenceGrant", "referencegrants"),
				gateway("BackendTLSPolicy", "backendtlspolicies"),
			},
		),
	},
}
