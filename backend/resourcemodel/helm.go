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
) ResourceModel {
	facts := BuildHelmReleaseFacts(rel, resources, history)
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

func BuildHelmReleaseFacts(rel *release.Release, resources []ResourceLink, history []*release.Release) HelmReleaseFacts {
	facts := HelmReleaseFacts{
		Resources: append([]ResourceLink(nil), resources...),
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
		facts.Notes = rel.Info.Notes
	}
	if len(history) > 0 {
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

func BuildHelmManifestResourceLink(clusterID, apiVersion, kind, namespace, name string) ResourceLink {
	group, version := splitAPIVersion(strings.TrimSpace(apiVersion))
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	if kind == "" || name == "" || version == "" {
		return displayResourceLink(clusterID, group, version, kind, "", namespace, name)
	}
	if namespace == "" {
		return clusterResourceLink(clusterID, group, version, kind, "", name, "")
	}
	return namespacedResourceLink(clusterID, group, version, kind, "", namespace, name, "")
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
