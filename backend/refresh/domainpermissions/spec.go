// Package domainpermissions owns the shared refresh-domain resource contracts
// used by runtime permission checks, registration gates, and resource streams.
package domainpermissions

import (
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resourcecontract"
)

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

// Composition is the Kubernetes resource composition for one refresh domain
// before it is converted into verb-specific permission requirements.
type Composition struct {
	Domain  string
	Mode    Mode
	Reason  string
	Runtime []Resource
	Stream  []Resource
}

type policySpec struct {
	Domain  string
	Mode    Mode
	Reason  string
	Runtime []Resource
	Stream  []Resource
}

// Compositions returns the shared resource composition for refresh domains.
func Compositions() []Composition {
	result := make([]Composition, 0, len(policySpecs))
	for _, spec := range policySpecs {
		result = append(result, Composition{
			Domain:  spec.Domain,
			Mode:    spec.Mode,
			Reason:  spec.Reason,
			Runtime: copyResources(spec.Runtime),
			Stream:  copyResources(spec.Stream),
		})
	}
	return result
}

// CompositionByDomain returns the resource composition keyed by domain.
func CompositionByDomain() map[string]Composition {
	result := make(map[string]Composition, len(policySpecs))
	for _, composition := range Compositions() {
		result[composition.Domain] = composition
	}
	return result
}

// StreamDomains returns the domains with resource-stream list/watch resources.
func StreamDomains() []string {
	result := make([]string, 0, len(policySpecs))
	for _, spec := range policySpecs {
		if len(spec.Stream) == 0 {
			continue
		}
		result = append(result, spec.Domain)
	}
	return result
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
	for _, composition := range Compositions() {
		if len(composition.Runtime) == 0 {
			continue
		}
		result[composition.Domain] = copyResources(composition.Runtime)
	}
	return result
}

// StreamResourcesByDomain returns the resource stream composition keyed by domain.
func StreamResourcesByDomain() map[string][]Resource {
	result := make(map[string][]Resource)
	for _, composition := range Compositions() {
		if len(composition.Stream) == 0 {
			continue
		}
		result[composition.Domain] = copyResources(composition.Stream)
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

func copyResources(src []Resource) []Resource {
	return append([]Resource(nil), src...)
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

func core(version, kind string) Resource {
	return builtinResource("", version, kind)
}

func apps(kind string) Resource {
	return builtinResource("apps", "v1", kind)
}

func batch(kind string) Resource {
	return builtinResource("batch", "v1", kind)
}

func autoscaling(kind string) Resource {
	return builtinResource("autoscaling", "v1", kind)
}

func discovery(kind string) Resource {
	return builtinResource("discovery.k8s.io", "v1", kind)
}

func networking(kind string) Resource {
	return builtinResource("networking.k8s.io", "v1", kind)
}

func gateway(kind string) Resource {
	return builtinResource("gateway.networking.k8s.io", "v1", kind)
}

func rbac(kind string) Resource {
	return builtinResource("rbac.authorization.k8s.io", "v1", kind)
}

func policy(kind string) Resource {
	return builtinResource("policy", "v1", kind)
}

func storage(kind string) Resource {
	return builtinResource("storage.k8s.io", "v1", kind)
}

func admission(kind string) Resource {
	return builtinResource("admissionregistration.k8s.io", "v1", kind)
}

func apiextensions(kind string) Resource {
	return builtinResource("apiextensions.k8s.io", "v1", kind)
}

// builtinResource sources one domain resource from the single contract — the
// group/version/kind/resource identity is never re-spelled here.
func builtinResource(group, version, kind string) Resource {
	desc := resourcecontract.MustBuiltin(group, version, kind)
	return Resource{
		Group:    desc.Group,
		Version:  desc.Version,
		Kind:     desc.Kind,
		Resource: desc.Resource,
	}
}

var policySpecs = []policySpec{
	{
		Domain:  "namespaces",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Namespace")},
	},
	{
		Domain: "namespace-workloads",
		Mode:   ModeAny,
		Reason: "workload resources",
		Runtime: []Resource{
			core("v1", "Pod"),
			apps("Deployment"),
			apps("StatefulSet"),
			apps("DaemonSet"),
			batch("Job"),
			batch("CronJob"),
		},
		Stream: []Resource{
			core("v1", "Pod"),
			apps("ReplicaSet"),
			apps("Deployment"),
			apps("StatefulSet"),
			apps("DaemonSet"),
			batch("Job"),
			batch("CronJob"),
			autoscaling("HorizontalPodAutoscaler"),
		},
	},
	{
		Domain:  "namespace-config",
		Mode:    ModeAny,
		Reason:  "core/configmaps,secrets",
		Runtime: []Resource{core("v1", "ConfigMap"), core("v1", "Secret")},
		Stream:  []Resource{core("v1", "ConfigMap"), core("v1", "Secret")},
	},
	{
		Domain: "namespace-network",
		Mode:   ModeAny,
		Reason: "network resources",
		Runtime: []Resource{
			core("v1", "Service"),
			discovery("EndpointSlice"),
			networking("Ingress"),
			networking("NetworkPolicy"),
			gateway("Gateway"),
			gateway("HTTPRoute"),
			gateway("GRPCRoute"),
			gateway("TLSRoute"),
			gateway("ListenerSet"),
			gateway("ReferenceGrant"),
			gateway("BackendTLSPolicy"),
		},
		Stream: []Resource{
			core("v1", "Service"),
			discovery("EndpointSlice"),
			networking("Ingress"),
			networking("NetworkPolicy"),
			gateway("Gateway"),
			gateway("HTTPRoute"),
			gateway("GRPCRoute"),
			gateway("TLSRoute"),
			gateway("ListenerSet"),
			gateway("ReferenceGrant"),
			gateway("BackendTLSPolicy"),
		},
	},
	{
		Domain:  "namespace-storage",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "PersistentVolumeClaim")},
		Stream:  []Resource{core("v1", "PersistentVolumeClaim")},
	},
	{
		Domain:  "namespace-autoscaling",
		Mode:    ModeAll,
		Runtime: []Resource{autoscaling("HorizontalPodAutoscaler")},
		Stream:  []Resource{autoscaling("HorizontalPodAutoscaler")},
	},
	{
		Domain: "namespace-quotas",
		Mode:   ModeAny,
		Reason: "quota resources",
		Runtime: []Resource{
			core("v1", "ResourceQuota"),
			core("v1", "LimitRange"),
			policy("PodDisruptionBudget"),
		},
		Stream: []Resource{
			core("v1", "ResourceQuota"),
			core("v1", "LimitRange"),
			policy("PodDisruptionBudget"),
		},
	},
	{
		Domain: "namespace-rbac",
		Mode:   ModeAny,
		Reason: "rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
		Runtime: []Resource{
			rbac("Role"),
			rbac("RoleBinding"),
			core("v1", "ServiceAccount"),
		},
		Stream: []Resource{
			rbac("Role"),
			rbac("RoleBinding"),
			core("v1", "ServiceAccount"),
		},
	},
	{
		Domain:  "namespace-custom",
		Mode:    ModeAll,
		Runtime: []Resource{apiextensions("CustomResourceDefinition")},
		Stream:  []Resource{apiextensions("CustomResourceDefinition")},
	},
	{
		Domain:  "namespace-helm",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Secret")},
		// Runtime Helm list operations are secret-backed in the normal Helm
		// storage path. Streams also watch ConfigMaps so configmap-backed Helm
		// release storage can trigger namespace-level resyncs when permitted.
		Stream: []Resource{core("v1", "Secret"), core("v1", "ConfigMap")},
	},
	{
		Domain:  "namespace-events",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Event")},
	},
	{
		Domain:  "pods",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Pod")},
		Stream:  []Resource{core("v1", "Pod")},
	},
	{
		Domain:  "nodes",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Node")},
		Stream:  []Resource{core("v1", "Node")},
	},
	{
		Domain:  "cluster-overview",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Node")},
	},
	{
		Domain:  "cluster-rbac",
		Mode:    ModeAny,
		Reason:  "rbac.authorization.k8s.io",
		Runtime: []Resource{rbac("ClusterRole"), rbac("ClusterRoleBinding")},
		Stream:  []Resource{rbac("ClusterRole"), rbac("ClusterRoleBinding")},
	},
	{
		Domain:  "cluster-storage",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "PersistentVolume")},
		Stream:  []Resource{core("v1", "PersistentVolume")},
	},
	{
		Domain: "cluster-config",
		Mode:   ModeAny,
		Reason: "cluster configuration resources",
		Runtime: []Resource{
			storage("StorageClass"),
			networking("IngressClass"),
			gateway("GatewayClass"),
			admission("ValidatingWebhookConfiguration"),
			admission("MutatingWebhookConfiguration"),
		},
		Stream: []Resource{
			storage("StorageClass"),
			networking("IngressClass"),
			gateway("GatewayClass"),
			admission("ValidatingWebhookConfiguration"),
			admission("MutatingWebhookConfiguration"),
		},
	},
	{
		Domain:  "cluster-crds",
		Mode:    ModeAll,
		Runtime: []Resource{apiextensions("CustomResourceDefinition")},
		Stream:  []Resource{apiextensions("CustomResourceDefinition")},
	},
	{
		Domain:  "cluster-custom",
		Mode:    ModeAll,
		Runtime: []Resource{apiextensions("CustomResourceDefinition")},
		Stream:  []Resource{apiextensions("CustomResourceDefinition")},
	},
	{
		Domain:  "cluster-events",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Event")},
	},
	{
		Domain:  "object-events",
		Mode:    ModeAll,
		Runtime: []Resource{core("v1", "Event")},
	},
	{
		Domain: "object-map",
		Mode:   ModeAny,
		Reason: "object map resources",
		Runtime: resources(
			[]Resource{
				core("v1", "Pod"),
				core("v1", "Service"),
				discovery("EndpointSlice"),
				core("v1", "PersistentVolumeClaim"),
				core("v1", "PersistentVolume"),
				storage("StorageClass"),
				core("v1", "ConfigMap"),
				core("v1", "Secret"),
				core("v1", "ServiceAccount"),
				core("v1", "Node"),
			},
			[]Resource{
				apps("Deployment"),
				apps("ReplicaSet"),
				apps("StatefulSet"),
				apps("DaemonSet"),
				batch("Job"),
				batch("CronJob"),
				autoscaling("HorizontalPodAutoscaler"),
				networking("Ingress"),
				networking("IngressClass"),
			},
			[]Resource{
				gateway("GatewayClass"),
				gateway("Gateway"),
				gateway("HTTPRoute"),
				gateway("GRPCRoute"),
				gateway("TLSRoute"),
				gateway("ListenerSet"),
				gateway("ReferenceGrant"),
				gateway("BackendTLSPolicy"),
			},
		),
	},
}
