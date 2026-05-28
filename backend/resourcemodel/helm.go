package resourcemodel

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"helm.sh/helm/v3/pkg/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
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
	return BuildHelmManifestResourceLinksWithResolver(context.Background(), nil, clusterID, resources)
}

func BuildHelmManifestResourceLinksWithResolver(ctx context.Context, resolver common.ResourceResolver, clusterID string, resources []HelmManifestResourceFacts) []ResourceLink {
	if len(resources) == 0 {
		return nil
	}
	links := make([]ResourceLink, 0, len(resources))
	for _, resource := range resources {
		link := BuildHelmManifestResourceLinkWithResolver(ctx, resolver, clusterID, resource.APIVersion, resource.Kind, resource.Namespace, resource.Name)
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

func BuildHelmManifestResourceLink(clusterID, apiVersion, kind, namespace, name string) ResourceLink {
	return BuildHelmManifestResourceLinkWithResolver(context.Background(), nil, clusterID, apiVersion, kind, namespace, name)
}

func BuildHelmManifestResourceLinkWithResolver(ctx context.Context, resolver common.ResourceResolver, clusterID, apiVersion, kind, namespace, name string) ResourceLink {
	return BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(ctx, resolver, clusterID, apiVersion, kind, namespace, name, strings.TrimSpace(namespace) != "")
}

func BuildHelmManifestResourceLinkWithNamespaceSource(clusterID, apiVersion, kind, namespace, name string, namespaceExplicit bool) ResourceLink {
	return BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(context.Background(), nil, clusterID, apiVersion, kind, namespace, name, namespaceExplicit)
}

func BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(ctx context.Context, resolver common.ResourceResolver, clusterID, apiVersion, kind, namespace, name string, namespaceExplicit bool) ResourceLink {
	identity := ResolveHelmManifestResourceIdentityWithResolver(ctx, resolver, apiVersion, kind, namespace, name, namespaceExplicit)
	if !identity.Openable {
		return displayResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name)
	}
	if identity.Scope == ResourceScopeCluster {
		return clusterResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Name, "")
	}
	return namespacedResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name, "")
}

func ResolveHelmManifestResourceIdentity(apiVersion, kind, namespace, name string, namespaceExplicit bool) HelmManifestResourceIdentity {
	return ResolveHelmManifestResourceIdentityWithResolver(context.Background(), nil, apiVersion, kind, namespace, name, namespaceExplicit)
}

func ResolveHelmManifestResourceIdentityWithResolver(ctx context.Context, resolver common.ResourceResolver, apiVersion, kind, namespace, name string, namespaceExplicit bool) HelmManifestResourceIdentity {
	if ctx == nil {
		ctx = context.Background()
	}
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
	if resolver != nil {
		resolved, ok, err := resolver.ResolveResourceForGVK(ctx, schema.GroupVersionKind{
			Group:   group,
			Version: version,
			Kind:    kind,
		})
		if err == nil && ok {
			identity.Group = resolved.Group
			identity.Version = resolved.Version
			identity.Kind = resolved.Kind
			identity.Resource = resolved.Resource
			if resolved.Namespaced {
				identity.Scope = ResourceScopeNamespaced
				identity.Openable = namespace != ""
				return identity
			}
			identity.Scope = ResourceScopeCluster
			identity.Namespace = ""
			identity.Openable = true
			return identity
		}
	}
	if namespaceExplicit && namespace != "" {
		identity.Scope = ResourceScopeNamespaced
		identity.Openable = true
	}
	return identity
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
