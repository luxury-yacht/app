/*
 * backend/resources/helm/model.go
 *
 * HelmRelease resource model: the single definition of a Helm release's intrinsic
 * fields + status presentation. HelmRelease is a synthetic kind (helm.sh/v3) built
 * from helm storage records. The manifest resource-link helpers (shared with the
 * snapshot object-content builder) stay in resourcemodel. Shared model primitives
 * come from resourcemodel.
 */

package helm

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"helm.sh/helm/v3/pkg/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const syntheticAPIGroup = "helm.sh"

// BuildResourceModel builds the HelmRelease resource model. Facts are owned by this
// package (helm.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(
	clusterID string,
	rel *release.Release,
	namespaceFallback string,
	resources []resourcemodel.ResourceLink,
	history []*release.Release,
	options ...resourcemodel.ResourceModelBuildOptions,
) resourcemodel.ResourceModel {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := BuildFacts(rel, resources, history, buildOptions)
	status := statusPresentation(facts)
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
		labels = resourcemodel.CopyStringMap(rel.Labels)
		if rel.Chart != nil && rel.Chart.Metadata != nil {
			annotations = resourcemodel.CopyStringMap(rel.Chart.Metadata.Annotations)
		}
		if rel.Info != nil && !rel.Info.FirstDeployed.IsZero() {
			created = metav1.NewTime(rel.Info.FirstDeployed.Time)
		}
	}
	return resourcemodel.ResourceModel{
		Ref: resourcemodel.ResourceRef{
			ClusterID: clusterID,
			Group:     syntheticAPIGroup,
			Version:   "v3",
			Kind:      "HelmRelease",
			Resource:  "releases",
			Namespace: namespace,
			Name:      name,
		},
		Source: resourcemodel.ResourceSourceSynthetic,
		Scope:  resourcemodel.ResourceScopeNamespaced,
		Metadata: resourcemodel.ResourceMetadata{
			Labels:            labels,
			Annotations:       annotations,
			CreationTimestamp: created,
		},
		Status: status,
		Facts:  resourcemodel.ResourceFacts{},
	}
}

// BuildFacts extracts the HelmRelease facts. Resources/Notes/History materialize
// only with the relationship/detail materialization flags.
func BuildFacts(rel *release.Release, resources []resourcemodel.ResourceLink, history []*release.Release, options resourcemodel.ResourceModelBuildOptions) Facts {
	facts := Facts{}
	if options.Materialization.Has(resourcemodel.MaterializeRelationshipFacts) || options.Materialization.Has(resourcemodel.MaterializeDetailFacts) {
		facts.Resources = append([]resourcemodel.ResourceLink(nil), resources...)
	}
	if rel == nil {
		return facts
	}
	facts.Revision = rel.Version
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		facts.Chart = chartName(rel)
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
	if options.Materialization.Has(resourcemodel.MaterializeDetailFacts) && rel.Info != nil {
		facts.Notes = rel.Info.Notes
	}
	if options.Materialization.Has(resourcemodel.MaterializeDetailFacts) && len(history) > 0 {
		facts.History = make([]HelmRevisionFacts, 0, len(history))
		for _, rev := range history {
			if rev == nil {
				continue
			}
			next := HelmRevisionFacts{Revision: rev.Version}
			if rev.Chart != nil && rev.Chart.Metadata != nil {
				next.Chart = chartName(rev)
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

func statusPresentation(facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strings.TrimSpace(facts.RawStatus)
	if state == "" {
		state = "unknown"
	}
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "info.status",
		Status: state,
	}}
	return resourcemodel.ResourceStatusPresentation{
		Label:        state,
		State:        state,
		Presentation: presentationForState(state),
		Reason:       "info.status",
		Message:      facts.Description,
		Signals:      signals,
		Lifecycle:    resourcemodel.ResourceLifecycle{},
	}
}

func chartName(rel *release.Release) string {
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

func presentationForState(state string) string {
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
