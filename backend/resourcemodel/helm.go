package resourcemodel

import (
	"strings"

	"helm.sh/helm/v3/pkg/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const helmSyntheticAPIGroup = "helm.sh"

func BuildHelmReleaseResourceModel(
	clusterID string,
	rel *release.Release,
	namespaceFallback string,
	resources []ResourceLink,
	history []*release.Release,
	options ...ResourceModelBuildOptions,
) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildHelmReleaseFacts(rel, resources, history, buildOptions)
	status := BuildHelmReleaseStatusPresentation(facts)
	namespace := strings.TrimSpace(namespaceFallback)
	name := ""
	labels := map[string]string(nil)
	annotations := map[string]string(nil)
	created := metav1.Time{}
	if rel != nil {
		name = rel.Name
		if strings.TrimSpace(rel.Namespace) != "" {
			namespace = rel.Namespace
		}
		labels = copyStringMap(rel.Labels)
		if rel.Chart != nil && rel.Chart.Metadata != nil {
			annotations = copyStringMap(rel.Chart.Metadata.Annotations)
		}
		if rel.Info != nil && !rel.Info.FirstDeployed.IsZero() {
			created = metav1.NewTime(rel.Info.FirstDeployed.Time)
		}
	}
	return ResourceModel{
		Ref: ResourceRef{
			ClusterID: clusterID,
			Group:     helmSyntheticAPIGroup,
			Version:   "v3",
			Kind:      "HelmRelease",
			Resource:  "releases",
			Namespace: namespace,
			Name:      name,
		},
		Source: ResourceSourceSynthetic,
		Scope:  ResourceScopeNamespaced,
		Metadata: ResourceMetadata{
			Labels:            labels,
			Annotations:       annotations,
			CreationTimestamp: created,
		},
		Status: status,
		Facts:  ResourceFacts{HelmRelease: &facts},
	}
}

func BuildHelmReleaseFacts(rel *release.Release, resources []ResourceLink, history []*release.Release, options ResourceModelBuildOptions) HelmReleaseFacts {
	facts := HelmReleaseFacts{}
	if options.Materialization.Has(MaterializeRelationshipFacts) || options.Materialization.Has(MaterializeDetailFacts) {
		facts.Resources = append([]ResourceLink(nil), resources...)
	}
	if rel == nil {
		return facts
	}
	facts.Revision = rel.Version
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		facts.Chart = helmChartName(rel)
		facts.Version = rel.Chart.Metadata.Version
		facts.AppVersion = rel.Chart.Metadata.AppVersion
	}
	if rel.Info != nil {
		facts.RawStatus = rel.Info.Status.String()
		if !rel.Info.LastDeployed.IsZero() {
			updated := metav1.NewTime(rel.Info.LastDeployed.Time)
			facts.Updated = &updated
		}
		facts.Description = rel.Info.Description
	}
	if options.Materialization.Has(MaterializeDetailFacts) && rel.Info != nil {
		facts.Notes = rel.Info.Notes
	}
	if options.Materialization.Has(MaterializeDetailFacts) && len(history) > 0 {
		facts.History = make([]HelmRevisionFacts, 0, len(history))
		for _, rev := range history {
			if rev == nil {
				continue
			}
			next := HelmRevisionFacts{
				Revision: rev.Version,
			}
			if rev.Chart != nil && rev.Chart.Metadata != nil {
				next.Chart = helmChartName(rev)
				next.AppVersion = rev.Chart.Metadata.AppVersion
			}
			if rev.Info != nil {
				next.Status = rev.Info.Status.String()
				next.Description = rev.Info.Description
				if !rev.Info.LastDeployed.IsZero() {
					updated := metav1.NewTime(rev.Info.LastDeployed.Time)
					next.Updated = &updated
				}
			}
			facts.History = append(facts.History, next)
		}
	}
	return facts
}

func BuildHelmReleaseStatusPresentation(facts HelmReleaseFacts) ResourceStatusPresentation {
	state := strings.TrimSpace(facts.RawStatus)
	if state == "" {
		state = "unknown"
	}
	lifecycle := ResourceLifecycle{}
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "info.status",
		Status: state,
	}}
	return ResourceStatusPresentation{
		Label:        state,
		State:        state,
		Presentation: helmReleasePresentation(state),
		Reason:       "info.status",
		Message:      facts.Description,
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func BuildHelmManifestResourceLinks(clusterID string, resources []HelmManifestResourceFacts) []ResourceLink {
	if len(resources) == 0 {
		return nil
	}
	links := make([]ResourceLink, 0, len(resources))
	for _, resource := range resources {
		link := BuildHelmManifestResourceLink(clusterID, resource.APIVersion, resource.Kind, resource.Namespace, resource.Name)
		if link.Ref != nil || link.Display != nil {
			links = append(links, link)
		}
	}
	return links
}

type HelmManifestResourceFacts struct {
	APIVersion string
	Kind       string
	Namespace  string
	Name       string
}

type HelmManifestResourceIdentity struct {
	Group     string
	Version   string
	Kind      string
	Resource  string
	Namespace string
	Name      string
	Scope     ResourceScope
	Openable  bool
}

type helmManifestBuiltinResource struct {
	group      string
	version    string
	kind       string
	resource   string
	namespaced bool
}

var helmManifestBuiltinResources = map[string]helmManifestBuiltinResource{
	helmManifestBuiltinKey("", "v1", "Pod"):                                                        {version: "v1", kind: "Pod", resource: "pods", namespaced: true},
	helmManifestBuiltinKey("", "v1", "Service"):                                                    {version: "v1", kind: "Service", resource: "services", namespaced: true},
	helmManifestBuiltinKey("", "v1", "ConfigMap"):                                                  {version: "v1", kind: "ConfigMap", resource: "configmaps", namespaced: true},
	helmManifestBuiltinKey("", "v1", "Secret"):                                                     {version: "v1", kind: "Secret", resource: "secrets", namespaced: true},
	helmManifestBuiltinKey("", "v1", "ServiceAccount"):                                             {version: "v1", kind: "ServiceAccount", resource: "serviceaccounts", namespaced: true},
	helmManifestBuiltinKey("", "v1", "Event"):                                                      {version: "v1", kind: "Event", resource: "events", namespaced: true},
	helmManifestBuiltinKey("", "v1", "LimitRange"):                                                 {version: "v1", kind: "LimitRange", resource: "limitranges", namespaced: true},
	helmManifestBuiltinKey("", "v1", "ResourceQuota"):                                              {version: "v1", kind: "ResourceQuota", resource: "resourcequotas", namespaced: true},
	helmManifestBuiltinKey("", "v1", "PersistentVolumeClaim"):                                      {version: "v1", kind: "PersistentVolumeClaim", resource: "persistentvolumeclaims", namespaced: true},
	helmManifestBuiltinKey("", "v1", "Namespace"):                                                  {version: "v1", kind: "Namespace", resource: "namespaces"},
	helmManifestBuiltinKey("", "v1", "Node"):                                                       {version: "v1", kind: "Node", resource: "nodes"},
	helmManifestBuiltinKey("", "v1", "PersistentVolume"):                                           {version: "v1", kind: "PersistentVolume", resource: "persistentvolumes"},
	helmManifestBuiltinKey("apps", "v1", "Deployment"):                                             {group: "apps", version: "v1", kind: "Deployment", resource: "deployments", namespaced: true},
	helmManifestBuiltinKey("apps", "v1", "StatefulSet"):                                            {group: "apps", version: "v1", kind: "StatefulSet", resource: "statefulsets", namespaced: true},
	helmManifestBuiltinKey("apps", "v1", "DaemonSet"):                                              {group: "apps", version: "v1", kind: "DaemonSet", resource: "daemonsets", namespaced: true},
	helmManifestBuiltinKey("apps", "v1", "ReplicaSet"):                                             {group: "apps", version: "v1", kind: "ReplicaSet", resource: "replicasets", namespaced: true},
	helmManifestBuiltinKey("batch", "v1", "Job"):                                                   {group: "batch", version: "v1", kind: "Job", resource: "jobs", namespaced: true},
	helmManifestBuiltinKey("batch", "v1", "CronJob"):                                               {group: "batch", version: "v1", kind: "CronJob", resource: "cronjobs", namespaced: true},
	helmManifestBuiltinKey("autoscaling", "v1", "HorizontalPodAutoscaler"):                         {group: "autoscaling", version: "v1", kind: "HorizontalPodAutoscaler", resource: "horizontalpodautoscalers", namespaced: true},
	helmManifestBuiltinKey("autoscaling", "v2", "HorizontalPodAutoscaler"):                         {group: "autoscaling", version: "v2", kind: "HorizontalPodAutoscaler", resource: "horizontalpodautoscalers", namespaced: true},
	helmManifestBuiltinKey("networking.k8s.io", "v1", "Ingress"):                                   {group: "networking.k8s.io", version: "v1", kind: "Ingress", resource: "ingresses", namespaced: true},
	helmManifestBuiltinKey("networking.k8s.io", "v1", "NetworkPolicy"):                             {group: "networking.k8s.io", version: "v1", kind: "NetworkPolicy", resource: "networkpolicies", namespaced: true},
	helmManifestBuiltinKey("networking.k8s.io", "v1", "IngressClass"):                              {group: "networking.k8s.io", version: "v1", kind: "IngressClass", resource: "ingressclasses"},
	helmManifestBuiltinKey("discovery.k8s.io", "v1", "EndpointSlice"):                              {group: "discovery.k8s.io", version: "v1", kind: "EndpointSlice", resource: "endpointslices", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "Gateway"):                           {group: "gateway.networking.k8s.io", version: "v1", kind: "Gateway", resource: "gateways", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "HTTPRoute"):                         {group: "gateway.networking.k8s.io", version: "v1", kind: "HTTPRoute", resource: "httproutes", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "GRPCRoute"):                         {group: "gateway.networking.k8s.io", version: "v1", kind: "GRPCRoute", resource: "grpcroutes", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "TLSRoute"):                          {group: "gateway.networking.k8s.io", version: "v1", kind: "TLSRoute", resource: "tlsroutes", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "ListenerSet"):                       {group: "gateway.networking.k8s.io", version: "v1", kind: "ListenerSet", resource: "listenersets", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "BackendTLSPolicy"):                  {group: "gateway.networking.k8s.io", version: "v1", kind: "BackendTLSPolicy", resource: "backendtlspolicies", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "ReferenceGrant"):                    {group: "gateway.networking.k8s.io", version: "v1", kind: "ReferenceGrant", resource: "referencegrants", namespaced: true},
	helmManifestBuiltinKey("gateway.networking.k8s.io", "v1", "GatewayClass"):                      {group: "gateway.networking.k8s.io", version: "v1", kind: "GatewayClass", resource: "gatewayclasses"},
	helmManifestBuiltinKey("rbac.authorization.k8s.io", "v1", "Role"):                              {group: "rbac.authorization.k8s.io", version: "v1", kind: "Role", resource: "roles", namespaced: true},
	helmManifestBuiltinKey("rbac.authorization.k8s.io", "v1", "RoleBinding"):                       {group: "rbac.authorization.k8s.io", version: "v1", kind: "RoleBinding", resource: "rolebindings", namespaced: true},
	helmManifestBuiltinKey("rbac.authorization.k8s.io", "v1", "ClusterRole"):                       {group: "rbac.authorization.k8s.io", version: "v1", kind: "ClusterRole", resource: "clusterroles"},
	helmManifestBuiltinKey("rbac.authorization.k8s.io", "v1", "ClusterRoleBinding"):                {group: "rbac.authorization.k8s.io", version: "v1", kind: "ClusterRoleBinding", resource: "clusterrolebindings"},
	helmManifestBuiltinKey("policy", "v1", "PodDisruptionBudget"):                                  {group: "policy", version: "v1", kind: "PodDisruptionBudget", resource: "poddisruptionbudgets", namespaced: true},
	helmManifestBuiltinKey("storage.k8s.io", "v1", "StorageClass"):                                 {group: "storage.k8s.io", version: "v1", kind: "StorageClass", resource: "storageclasses"},
	helmManifestBuiltinKey("admissionregistration.k8s.io", "v1", "MutatingWebhookConfiguration"):   {group: "admissionregistration.k8s.io", version: "v1", kind: "MutatingWebhookConfiguration", resource: "mutatingwebhookconfigurations"},
	helmManifestBuiltinKey("admissionregistration.k8s.io", "v1", "ValidatingWebhookConfiguration"): {group: "admissionregistration.k8s.io", version: "v1", kind: "ValidatingWebhookConfiguration", resource: "validatingwebhookconfigurations"},
	helmManifestBuiltinKey("apiextensions.k8s.io", "v1", "CustomResourceDefinition"):               {group: "apiextensions.k8s.io", version: "v1", kind: "CustomResourceDefinition", resource: "customresourcedefinitions"},
}

func BuildHelmManifestResourceLink(clusterID, apiVersion, kind, namespace, name string) ResourceLink {
	return BuildHelmManifestResourceLinkWithNamespaceSource(clusterID, apiVersion, kind, namespace, name, strings.TrimSpace(namespace) != "")
}

func BuildHelmManifestResourceLinkWithNamespaceSource(clusterID, apiVersion, kind, namespace, name string, namespaceExplicit bool) ResourceLink {
	identity := ResolveHelmManifestResourceIdentity(apiVersion, kind, namespace, name, namespaceExplicit)
	if !identity.Openable {
		return displayResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name)
	}
	if identity.Scope == ResourceScopeCluster {
		return clusterResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Name, "")
	}
	return namespacedResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name, "")
}

func ResolveHelmManifestResourceIdentity(apiVersion, kind, namespace, name string, namespaceExplicit bool) HelmManifestResourceIdentity {
	group, version := splitAPIVersion(strings.TrimSpace(apiVersion))
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	identity := HelmManifestResourceIdentity{
		Group:     group,
		Version:   version,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
	}
	if kind == "" || name == "" || version == "" {
		return identity
	}
	if builtin, ok := helmManifestBuiltinResources[helmManifestBuiltinKey(group, version, kind)]; ok {
		identity.Resource = builtin.resource
		if builtin.namespaced {
			identity.Scope = ResourceScopeNamespaced
			identity.Openable = namespace != ""
			return identity
		}
		identity.Scope = ResourceScopeCluster
		identity.Namespace = ""
		identity.Openable = true
		return identity
	}
	if namespaceExplicit && namespace != "" {
		identity.Scope = ResourceScopeNamespaced
		identity.Openable = true
	}
	return identity
}

func helmManifestBuiltinKey(group, version, kind string) string {
	return strings.TrimSpace(group) + "/" + strings.TrimSpace(version) + "/" + strings.ToLower(strings.TrimSpace(kind))
}

func helmChartName(rel *release.Release) string {
	if rel == nil || rel.Chart == nil || rel.Chart.Metadata == nil {
		return ""
	}
	name := rel.Chart.Name()
	version := rel.Chart.Metadata.Version
	if version == "" {
		return name
	}
	return name + "-" + version
}

func helmReleasePresentation(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "deployed", "superseded":
		return "ready"
	case "pending-install", "pending-upgrade", "pending-rollback":
		return "progressing"
	case "failed", "uninstalled", "uninstalling":
		return "error"
	default:
		return "unknown"
	}
}
