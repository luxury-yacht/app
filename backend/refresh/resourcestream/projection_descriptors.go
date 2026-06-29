// Package resourcestream keeps projection metadata aligned with the shared
// refresh-domain composition contract.
package resourcestream

import (
	"slices"

	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/resourcekind"
	apiextensionspkg "github.com/luxury-yacht/app/backend/resources/apiextensions"
	cronjobpkg "github.com/luxury-yacht/app/backend/resources/cronjob"
	daemonsetpkg "github.com/luxury-yacht/app/backend/resources/daemonset"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	endpointslicepkg "github.com/luxury-yacht/app/backend/resources/endpointslice"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	jobpkg "github.com/luxury-yacht/app/backend/resources/job"
	nodespkg "github.com/luxury-yacht/app/backend/resources/nodes"
	podspkg "github.com/luxury-yacht/app/backend/resources/pods"
	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"
	statefulsetpkg "github.com/luxury-yacht/app/backend/resources/statefulset"
)

// ProjectionDescriptor documents the row projection contract for a resource
// stream domain. The descriptor is intentionally metadata-only; stream
// registration stays behavior-specific so Kubernetes edge cases remain visible.
type ProjectionDescriptor struct {
	Domain               string
	ScopeKind            string
	SelectorShape        string
	RowIdentity          string
	UpdateIdentity       string
	PrimaryResources     []ResourceDescriptor
	RelatedResources     []ResourceDescriptor
	SourceClocks         []Source
	Projection           string
	AffectedRowResolver  string
	StaleScopeResolver   string
	CompleteIsScopeLevel bool
}

// MetricsDependency reports whether the domain's rows depend on the metric
// clock. It derives from SourceClocks so the metric clock has one authority.
func (d ProjectionDescriptor) MetricsDependency() bool {
	return slices.Contains(d.SourceClocks, SourceMetric)
}

type ResourceDescriptor struct {
	Group    string
	Version  string
	Kind     string
	Resource string
}

// SupportedDomains returns the refresh domains served by the resource
// WebSocket stream. The domainpermissions composition table owns the resource
// membership; stream registration and projections add behavior-specific wiring.
func SupportedDomains() []string {
	return domainpermissions.StreamDomains()
}

func ProjectionDescriptors() map[string]ProjectionDescriptor {
	result := make(map[string]ProjectionDescriptor, len(projectionDescriptors))
	for domain, descriptor := range projectionDescriptors {
		descriptor.PrimaryResources = append([]ResourceDescriptor(nil), descriptor.PrimaryResources...)
		descriptor.RelatedResources = append([]ResourceDescriptor(nil), descriptor.RelatedResources...)
		descriptor.SourceClocks = append([]Source(nil), descriptor.SourceClocks...)
		result[domain] = descriptor
	}
	return result
}

var projectionDescriptors = map[string]ProjectionDescriptor{
	domainPods: {
		Domain:               domainPods,
		ScopeKind:            "pod",
		SelectorShape:        "clusterId + namespace/name or namespace:*",
		RowIdentity:          "clusterId + /v1 Pod namespace/name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     []ResourceDescriptor{fromIdentity(podspkg.Identity)},
		RelatedResources:     []ResourceDescriptor{fromIdentity(replicasetpkg.Identity)},
		SourceClocks:         []Source{SourceObject},
		Projection:           "pods.BuildStreamSummary",
		AffectedRowResolver:  "pod event -> pod row, workload row, node row",
		StaleScopeResolver:   "stalePodScopes",
		CompleteIsScopeLevel: true,
	},
	domainWorkloads: {
		Domain:         domainWorkloads,
		ScopeKind:      "namespace",
		SelectorShape:  "clusterId + namespace",
		RowIdentity:    "clusterId + full workload GVK namespace/name",
		UpdateIdentity: "ref (full ResourceRef)",
		PrimaryResources: []ResourceDescriptor{
			fromIdentity(deploymentpkg.Identity),
			fromIdentity(statefulsetpkg.Identity),
			fromIdentity(daemonsetpkg.Identity),
			fromIdentity(jobpkg.Identity),
			fromIdentity(cronjobpkg.Identity),
			fromIdentity(podspkg.Identity),
		},
		RelatedResources: []ResourceDescriptor{
			fromIdentity(podspkg.Identity),
			fromIdentity(replicasetpkg.Identity),
			fromIdentity(hpapkg.IdentityV1),
		},
		SourceClocks:         []Source{SourceObject},
		Projection:           "snapshot.BuildWorkloadSummary / snapshot.BuildStandalonePodWorkloadSummary",
		AffectedRowResolver:  "workload, pod, HPA, ReplicaSet event resolvers",
		StaleScopeResolver:   "ReplicaSet and pod stale owner/scope resolvers",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceConfig: namespaceDescriptor(
		domainNamespaceConfig,
		"configmap.BuildStreamSummary / secret.BuildStreamSummary",
		streamResourceDescriptors(domainNamespaceConfig),
		[]ResourceDescriptor{},
	),
	domainNamespaceNetwork: {
		Domain:               domainNamespaceNetwork,
		ScopeKind:            "namespace",
		SelectorShape:        "clusterId + namespace",
		RowIdentity:          "clusterId + full network GVK namespace/name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     streamResourceDescriptors(domainNamespaceNetwork),
		RelatedResources:     []ResourceDescriptor{fromIdentity(endpointslicepkg.Identity)},
		SourceClocks:         []Source{SourceObject},
		Projection:           "service/ingress/networkpolicy/endpointslice/gatewayapi BuildStreamSummary",
		AffectedRowResolver:  "network object and EndpointSlice->Service resolvers",
		StaleScopeResolver:   "EndpointSlice old/new service resolver",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceRBAC: namespaceDescriptor(
		domainNamespaceRBAC,
		"role.BuildStreamSummary / rolebinding.BuildStreamSummary / serviceaccount.BuildStreamSummary",
		streamResourceDescriptors(domainNamespaceRBAC),
		[]ResourceDescriptor{},
	),
	domainNamespaceCustom: {
		Domain:               domainNamespaceCustom,
		ScopeKind:            "namespace",
		SelectorShape:        "clusterId + namespace",
		RowIdentity:          "clusterId + CRD-backed GVK namespace/name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     []ResourceDescriptor{},
		RelatedResources:     []ResourceDescriptor{fromIdentity(apiextensionspkg.Identity)},
		SourceClocks:         []Source{SourceObject},
		Projection:           "snapshot.BuildNamespaceCustomSummary",
		AffectedRowResolver:  "dynamic custom informer and CRD signature resolver",
		StaleScopeResolver:   "CRD custom stream signature resolver",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceHelm: {
		Domain:               domainNamespaceHelm,
		ScopeKind:            "namespace",
		SelectorShape:        "clusterId + namespace",
		RowIdentity:          "clusterId + helm.sh/v3 HelmRelease namespace/name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     streamResourceDescriptors(domainNamespaceHelm),
		RelatedResources:     streamResourceDescriptors(domainNamespaceHelm),
		SourceClocks:         []Source{SourceObject},
		Projection:           "snapshot.mapHelmReleases",
		AffectedRowResolver:  "Secret/ConfigMap old/new Helm release identity resolver",
		StaleScopeResolver:   "scope-level COMPLETE for affected namespaces",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceAutoscaling: namespaceDescriptor(
		domainNamespaceAutoscaling,
		"hpa.BuildStreamSummary",
		streamResourceDescriptors(domainNamespaceAutoscaling),
		[]ResourceDescriptor{},
	),
	domainNamespaceQuotas: namespaceDescriptor(
		domainNamespaceQuotas,
		"resourcequota.BuildStreamSummary / limitrange.BuildStreamSummary / poddisruptionbudget.BuildStreamSummary",
		streamResourceDescriptors(domainNamespaceQuotas),
		[]ResourceDescriptor{},
	),
	domainNamespaceStorage: namespaceDescriptor(
		domainNamespaceStorage,
		"persistentvolumeclaim.BuildStreamSummary",
		streamResourceDescriptors(domainNamespaceStorage),
		[]ResourceDescriptor{},
	),
	domainClusterRBAC: clusterDescriptor(
		domainClusterRBAC,
		"clusterrole.BuildStreamSummary / clusterrolebinding.BuildStreamSummary",
		streamResourceDescriptors(domainClusterRBAC),
	),
	domainClusterStorage: clusterDescriptor(
		domainClusterStorage,
		"persistentvolume.BuildStreamSummary",
		streamResourceDescriptors(domainClusterStorage),
	),
	domainClusterConfig: clusterDescriptor(
		domainClusterConfig,
		"storageclass.BuildStreamSummary / ingressclass.BuildStreamSummary / gatewayapi.BuildGatewayClassStreamSummary / admission.Build{Validating,Mutating}StreamSummary",
		streamResourceDescriptors(domainClusterConfig),
	),
	domainClusterCRDs: clusterDescriptor(
		domainClusterCRDs,
		"apiextensions.BuildStreamSummary",
		streamResourceDescriptors(domainClusterCRDs),
	),
	domainClusterCustom: {
		Domain:               domainClusterCustom,
		ScopeKind:            "cluster",
		SelectorShape:        "clusterId",
		RowIdentity:          "clusterId + CRD-backed GVK name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     []ResourceDescriptor{},
		RelatedResources:     []ResourceDescriptor{fromIdentity(apiextensionspkg.Identity)},
		SourceClocks:         []Source{SourceObject},
		Projection:           "snapshot.BuildClusterCustomSummary",
		AffectedRowResolver:  "dynamic custom informer and CRD signature resolver",
		StaleScopeResolver:   "CRD custom stream signature resolver",
		CompleteIsScopeLevel: true,
	},
	domainNodes: {
		Domain:               domainNodes,
		ScopeKind:            "cluster",
		SelectorShape:        "clusterId",
		RowIdentity:          "clusterId + /v1 Node name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     []ResourceDescriptor{fromIdentity(nodespkg.Identity)},
		RelatedResources:     []ResourceDescriptor{fromIdentity(podspkg.Identity)},
		SourceClocks:         []Source{SourceObject},
		Projection:           "snapshot.BuildNodeSummary",
		AffectedRowResolver:  "node and pod->node resolvers",
		StaleScopeResolver:   "pod old/new node resolver",
		CompleteIsScopeLevel: true,
	},
}

func namespaceDescriptor(domain, projection string, primary, related []ResourceDescriptor) ProjectionDescriptor {
	return ProjectionDescriptor{
		Domain:               domain,
		ScopeKind:            "namespace",
		SelectorShape:        "clusterId + namespace",
		RowIdentity:          "clusterId + full GVK namespace/name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     primary,
		RelatedResources:     related,
		SourceClocks:         []Source{SourceObject},
		Projection:           projection,
		AffectedRowResolver:  "direct object event resolver",
		StaleScopeResolver:   "none",
		CompleteIsScopeLevel: true,
	}
}

func clusterDescriptor(domain, projection string, primary []ResourceDescriptor) ProjectionDescriptor {
	return ProjectionDescriptor{
		Domain:               domain,
		ScopeKind:            "cluster",
		SelectorShape:        "clusterId",
		RowIdentity:          "clusterId + full GVK name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     primary,
		SourceClocks:         []Source{SourceObject},
		Projection:           projection,
		AffectedRowResolver:  "direct object event resolver",
		StaleScopeResolver:   "none",
		CompleteIsScopeLevel: true,
	}
}

func streamResourceDescriptors(domain string) []ResourceDescriptor {
	composition, ok := domainpermissions.CompositionByDomain()[domain]
	if !ok {
		return nil
	}
	resources := composition.Stream
	descriptors := make([]ResourceDescriptor, 0, len(resources))
	for _, resource := range resources {
		descriptors = append(descriptors, ResourceDescriptor{
			Group:    resource.Group,
			Version:  resource.Version,
			Kind:     resource.Kind,
			Resource: resource.Resource,
		})
	}
	return descriptors
}

// fromIdentity builds a stream ResourceDescriptor from a kind package's canonical
// Identity, so a projection references each kind instead of re-spelling it.
func fromIdentity(id resourcekind.Identity) ResourceDescriptor {
	return ResourceDescriptor{Group: id.Group, Version: id.Version, Kind: id.Kind, Resource: id.Resource}
}
