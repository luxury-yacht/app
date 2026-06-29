// Package domainpermissions owns the shared refresh-domain resource contracts
// used by runtime permission checks, registration gates, and resource streams.
package domainpermissions

import (
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resourcekind"
	admissionpkg "github.com/luxury-yacht/app/backend/resources/admission"
	apiextensionspkg "github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/events"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	"github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/namespaces"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
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

// fromIdentity builds a domain Resource from a kind package's canonical Identity,
// so a domain composition references each kind (e.g. deployment.Identity) instead
// of re-spelling its group/version/kind/resource.
func fromIdentity(id resourcekind.Identity) Resource {
	return Resource{
		Group:    id.Group,
		Version:  id.Version,
		Kind:     id.Kind,
		Resource: id.Resource,
	}
}

var policySpecs = []policySpec{
	{
		Domain:  "namespaces",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(namespaces.Identity)},
	},
	{
		Domain: "namespace-workloads",
		Mode:   ModeAny,
		Reason: "workload resources",
		Runtime: []Resource{
			fromIdentity(pods.Identity),
			fromIdentity(deployment.Identity),
			fromIdentity(statefulset.Identity),
			fromIdentity(daemonset.Identity),
			fromIdentity(job.Identity),
			fromIdentity(cronjob.Identity),
		},
		Stream: []Resource{
			fromIdentity(pods.Identity),
			fromIdentity(replicaset.Identity),
			fromIdentity(deployment.Identity),
			fromIdentity(statefulset.Identity),
			fromIdentity(daemonset.Identity),
			fromIdentity(job.Identity),
			fromIdentity(cronjob.Identity),
			fromIdentity(hpa.IdentityV1),
		},
	},
	{
		Domain: "namespace-workloads-metrics",
		Mode:   ModeAny,
		Reason: "workload resources",
		Runtime: []Resource{
			fromIdentity(pods.Identity),
			fromIdentity(deployment.Identity),
			fromIdentity(statefulset.Identity),
			fromIdentity(daemonset.Identity),
			fromIdentity(job.Identity),
			fromIdentity(cronjob.Identity),
		},
	},
	{
		Domain:  "namespace-config",
		Mode:    ModeAny,
		Reason:  "core/configmaps,secrets",
		Runtime: []Resource{fromIdentity(configmap.Identity), fromIdentity(secretpkg.Identity)},
		Stream:  []Resource{fromIdentity(configmap.Identity), fromIdentity(secretpkg.Identity)},
	},
	{
		Domain: "namespace-network",
		Mode:   ModeAny,
		Reason: "network resources",
		Runtime: []Resource{
			fromIdentity(service.Identity),
			fromIdentity(endpointslice.Identity),
			fromIdentity(ingress.Identity),
			fromIdentity(networkpolicy.Identity),
			fromIdentity(gatewaypkg.Identity),
			fromIdentity(httproute.Identity),
			fromIdentity(grpcroute.Identity),
			fromIdentity(tlsroute.Identity),
			fromIdentity(listenerset.Identity),
			fromIdentity(referencegrant.Identity),
			fromIdentity(backendtlspolicy.Identity),
		},
		Stream: []Resource{
			fromIdentity(service.Identity),
			fromIdentity(endpointslice.Identity),
			fromIdentity(ingress.Identity),
			fromIdentity(networkpolicy.Identity),
			fromIdentity(gatewaypkg.Identity),
			fromIdentity(httproute.Identity),
			fromIdentity(grpcroute.Identity),
			fromIdentity(tlsroute.Identity),
			fromIdentity(listenerset.Identity),
			fromIdentity(referencegrant.Identity),
			fromIdentity(backendtlspolicy.Identity),
		},
	},
	{
		Domain:  "namespace-storage",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(persistentvolumeclaim.Identity)},
		Stream:  []Resource{fromIdentity(persistentvolumeclaim.Identity)},
	},
	{
		Domain:  "namespace-autoscaling",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(hpa.IdentityV1)},
		Stream:  []Resource{fromIdentity(hpa.IdentityV1)},
	},
	{
		Domain: "namespace-quotas",
		Mode:   ModeAny,
		Reason: "quota resources",
		Runtime: []Resource{
			fromIdentity(resourcequota.Identity),
			fromIdentity(limitrange.Identity),
			fromIdentity(poddisruptionbudget.Identity),
		},
		Stream: []Resource{
			fromIdentity(resourcequota.Identity),
			fromIdentity(limitrange.Identity),
			fromIdentity(poddisruptionbudget.Identity),
		},
	},
	{
		Domain: "namespace-rbac",
		Mode:   ModeAny,
		Reason: "rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
		Runtime: []Resource{
			fromIdentity(role.Identity),
			fromIdentity(rolebinding.Identity),
			fromIdentity(serviceaccount.Identity),
		},
		Stream: []Resource{
			fromIdentity(role.Identity),
			fromIdentity(rolebinding.Identity),
			fromIdentity(serviceaccount.Identity),
		},
	},
	{
		Domain:  "namespace-custom",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(apiextensionspkg.Identity)},
		Stream:  []Resource{fromIdentity(apiextensionspkg.Identity)},
	},
	{
		Domain:  "namespace-helm",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(secretpkg.Identity)},
		// Runtime Helm list operations are secret-backed in the normal Helm
		// storage path. Streams also watch ConfigMaps so configmap-backed Helm
		// release storage can trigger namespace-level resyncs when permitted.
		Stream: []Resource{fromIdentity(secretpkg.Identity), fromIdentity(configmap.Identity)},
	},
	{
		Domain:  "namespace-events",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(events.Identity)},
	},
	{
		Domain:  "pods",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(pods.Identity)},
		Stream:  []Resource{fromIdentity(pods.Identity)},
	},
	{
		Domain:  "pods-metrics",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(pods.Identity)},
	},
	{
		Domain:  "nodes",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(nodes.Identity)},
		Stream:  []Resource{fromIdentity(nodes.Identity)},
	},
	{
		Domain:  "nodes-metrics",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(nodes.Identity)},
	},
	{
		Domain:  "cluster-overview",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(nodes.Identity)},
	},
	{
		Domain:  "cluster-rbac",
		Mode:    ModeAny,
		Reason:  "rbac.authorization.k8s.io",
		Runtime: []Resource{fromIdentity(clusterrole.Identity), fromIdentity(clusterrolebinding.Identity)},
		Stream:  []Resource{fromIdentity(clusterrole.Identity), fromIdentity(clusterrolebinding.Identity)},
	},
	{
		Domain:  "cluster-storage",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(persistentvolume.Identity)},
		Stream:  []Resource{fromIdentity(persistentvolume.Identity)},
	},
	{
		Domain: "cluster-config",
		Mode:   ModeAny,
		Reason: "cluster configuration resources",
		Runtime: []Resource{
			fromIdentity(storageclass.Identity),
			fromIdentity(ingressclass.Identity),
			fromIdentity(gatewayclass.Identity),
			fromIdentity(admissionpkg.ValidatingIdentity),
			fromIdentity(admissionpkg.MutatingIdentity),
		},
		Stream: []Resource{
			fromIdentity(storageclass.Identity),
			fromIdentity(ingressclass.Identity),
			fromIdentity(gatewayclass.Identity),
			fromIdentity(admissionpkg.ValidatingIdentity),
			fromIdentity(admissionpkg.MutatingIdentity),
		},
	},
	{
		Domain:  "cluster-crds",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(apiextensionspkg.Identity)},
		Stream:  []Resource{fromIdentity(apiextensionspkg.Identity)},
	},
	{
		Domain:  "cluster-custom",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(apiextensionspkg.Identity)},
		Stream:  []Resource{fromIdentity(apiextensionspkg.Identity)},
	},
	{
		Domain:  "cluster-events",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(events.Identity)},
	},
	{
		Domain:  "object-events",
		Mode:    ModeAll,
		Runtime: []Resource{fromIdentity(events.Identity)},
	},
	{
		Domain: "object-map",
		Mode:   ModeAny,
		Reason: "object map resources",
		Runtime: resources(
			[]Resource{
				fromIdentity(pods.Identity),
				fromIdentity(service.Identity),
				fromIdentity(endpointslice.Identity),
				fromIdentity(persistentvolumeclaim.Identity),
				fromIdentity(persistentvolume.Identity),
				fromIdentity(storageclass.Identity),
				fromIdentity(configmap.Identity),
				fromIdentity(secretpkg.Identity),
				fromIdentity(serviceaccount.Identity),
				fromIdentity(nodes.Identity),
			},
			[]Resource{
				fromIdentity(deployment.Identity),
				fromIdentity(replicaset.Identity),
				fromIdentity(statefulset.Identity),
				fromIdentity(daemonset.Identity),
				fromIdentity(job.Identity),
				fromIdentity(cronjob.Identity),
				fromIdentity(hpa.IdentityV1),
				fromIdentity(ingress.Identity),
				fromIdentity(ingressclass.Identity),
			},
			[]Resource{
				fromIdentity(gatewayclass.Identity),
				fromIdentity(gatewaypkg.Identity),
				fromIdentity(httproute.Identity),
				fromIdentity(grpcroute.Identity),
				fromIdentity(tlsroute.Identity),
				fromIdentity(listenerset.Identity),
				fromIdentity(referencegrant.Identity),
				fromIdentity(backendtlspolicy.Identity),
			},
		),
	},
}
