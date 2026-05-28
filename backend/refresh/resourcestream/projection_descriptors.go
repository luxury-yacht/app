package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/domainpermissions"

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
	MetricsDependency    bool
	Projection           string
	AffectedRowResolver  string
	StaleScopeResolver   string
	CompleteIsScopeLevel bool
}

type ResourceDescriptor struct {
	Group    string
	Version  string
	Kind     string
	Resource string
}

func ProjectionDescriptors() map[string]ProjectionDescriptor {
	result := make(map[string]ProjectionDescriptor, len(projectionDescriptors))
	for domain, descriptor := range projectionDescriptors {
		descriptor.PrimaryResources = append([]ResourceDescriptor(nil), descriptor.PrimaryResources...)
		descriptor.RelatedResources = append([]ResourceDescriptor(nil), descriptor.RelatedResources...)
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
		PrimaryResources:     []ResourceDescriptor{core("v1", "Pod", "pods")},
		RelatedResources:     []ResourceDescriptor{apps("ReplicaSet", "replicasets")},
		MetricsDependency:    true,
		Projection:           "snapshot.BuildPodSummary",
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
			apps("Deployment", "deployments"),
			apps("StatefulSet", "statefulsets"),
			apps("DaemonSet", "daemonsets"),
			batch("Job", "jobs"),
			batch("CronJob", "cronjobs"),
			core("v1", "Pod", "pods"),
		},
		RelatedResources: []ResourceDescriptor{
			core("v1", "Pod", "pods"),
			apps("ReplicaSet", "replicasets"),
			autoscaling("HorizontalPodAutoscaler", "horizontalpodautoscalers"),
		},
		MetricsDependency:    true,
		Projection:           "snapshot.BuildWorkloadSummary / snapshot.BuildStandalonePodWorkloadSummary",
		AffectedRowResolver:  "workload, pod, HPA, ReplicaSet event resolvers",
		StaleScopeResolver:   "ReplicaSet and pod stale owner/scope resolvers",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceConfig: namespaceDescriptor(
		domainNamespaceConfig,
		"snapshot.BuildConfigMapSummary / snapshot.BuildSecretSummary",
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
		RelatedResources:     []ResourceDescriptor{discovery("EndpointSlice", "endpointslices")},
		Projection:           "snapshot.Build*NetworkSummary",
		AffectedRowResolver:  "network object and EndpointSlice->Service resolvers",
		StaleScopeResolver:   "EndpointSlice old/new service resolver",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceRBAC: namespaceDescriptor(
		domainNamespaceRBAC,
		"snapshot.BuildRoleSummary / BuildRoleBindingSummary / BuildServiceAccountSummary",
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
		RelatedResources:     []ResourceDescriptor{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
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
		Projection:           "snapshot.mapHelmReleases",
		AffectedRowResolver:  "Secret/ConfigMap old/new Helm release identity resolver",
		StaleScopeResolver:   "scope-level COMPLETE for affected namespaces",
		CompleteIsScopeLevel: true,
	},
	domainNamespaceAutoscaling: namespaceDescriptor(
		domainNamespaceAutoscaling,
		"snapshot.BuildHPASummary",
		streamResourceDescriptors(domainNamespaceAutoscaling),
		[]ResourceDescriptor{},
	),
	domainNamespaceQuotas: namespaceDescriptor(
		domainNamespaceQuotas,
		"snapshot.BuildResourceQuotaSummary / BuildLimitRangeSummary / BuildPodDisruptionBudgetSummary",
		streamResourceDescriptors(domainNamespaceQuotas),
		[]ResourceDescriptor{},
	),
	domainNamespaceStorage: namespaceDescriptor(
		domainNamespaceStorage,
		"snapshot.BuildPVCStorageSummary",
		streamResourceDescriptors(domainNamespaceStorage),
		[]ResourceDescriptor{},
	),
	domainClusterRBAC: clusterDescriptor(
		domainClusterRBAC,
		"snapshot.BuildClusterRoleSummary / BuildClusterRoleBindingSummary",
		streamResourceDescriptors(domainClusterRBAC),
	),
	domainClusterStorage: clusterDescriptor(
		domainClusterStorage,
		"snapshot.BuildClusterStorageSummary",
		streamResourceDescriptors(domainClusterStorage),
	),
	domainClusterConfig: clusterDescriptor(
		domainClusterConfig,
		"snapshot.BuildCluster*Summary",
		streamResourceDescriptors(domainClusterConfig),
	),
	domainClusterCRDs: clusterDescriptor(
		domainClusterCRDs,
		"snapshot.BuildClusterCRDSummary",
		streamResourceDescriptors(domainClusterCRDs),
	),
	domainClusterCustom: {
		Domain:               domainClusterCustom,
		ScopeKind:            "cluster",
		SelectorShape:        "clusterId",
		RowIdentity:          "clusterId + CRD-backed GVK name",
		UpdateIdentity:       "ref (full ResourceRef)",
		PrimaryResources:     []ResourceDescriptor{},
		RelatedResources:     []ResourceDescriptor{apiextensions("CustomResourceDefinition", "customresourcedefinitions")},
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
		PrimaryResources:     []ResourceDescriptor{core("v1", "Node", "nodes")},
		RelatedResources:     []ResourceDescriptor{core("v1", "Pod", "pods")},
		MetricsDependency:    true,
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
		Projection:           projection,
		AffectedRowResolver:  "direct object event resolver",
		StaleScopeResolver:   "none",
		CompleteIsScopeLevel: true,
	}
}

func streamResourceDescriptors(domain string) []ResourceDescriptor {
	resources := domainpermissions.StreamResourcesByDomain()[domain]
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

func core(version, kind, resource string) ResourceDescriptor {
	return ResourceDescriptor{Version: version, Kind: kind, Resource: resource}
}

func apps(kind, resource string) ResourceDescriptor {
	return ResourceDescriptor{Group: "apps", Version: "v1", Kind: kind, Resource: resource}
}

func batch(kind, resource string) ResourceDescriptor {
	return ResourceDescriptor{Group: "batch", Version: "v1", Kind: kind, Resource: resource}
}

func autoscaling(kind, resource string) ResourceDescriptor {
	return ResourceDescriptor{Group: "autoscaling", Version: "v1", Kind: kind, Resource: resource}
}

func discovery(kind, resource string) ResourceDescriptor {
	return ResourceDescriptor{Group: "discovery.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}

func apiextensions(kind, resource string) ResourceDescriptor {
	return ResourceDescriptor{Group: "apiextensions.k8s.io", Version: "v1", Kind: kind, Resource: resource}
}
