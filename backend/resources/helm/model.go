/*
 * backend/resources/helm/model.go
 *
 * HelmRelease resource model: the single definition of a Helm release's intrinsic
 * fields + status presentation. HelmRelease is a synthetic kind (helm.sh/v3) built
 * from Helm storage records. Shared model primitives come from resourcemodel.
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
) resourcemodel.ResourceModel {
	state, description := "", ""
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
		if rel.Info != nil {
			state, description = rel.Info.Status.String(), rel.Info.Description
			if !rel.Info.FirstDeployed.IsZero() {
				created = metav1.NewTime(rel.Info.FirstDeployed.Time)
			}
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
		Status: statusPresentation(state, description),
		Facts:  resourcemodel.ResourceFacts{},
	}
}

// BuildFacts extracts HelmRelease facts. Notes and history materialize only
// with the detail materialization flag.
func BuildFacts(rel *release.Release, history []*release.Release, options resourcemodel.ResourceModelBuildOptions) Facts {
	facts := Facts{}
	if rel == nil {
		return facts
	}
	populateReleaseFacts(&facts, rel)
	if options.Materialization.Has(resourcemodel.MaterializeDetailFacts) {
		facts.Notes = releaseNotes(rel)
		facts.History = helmHistoryFacts(history)
	}
	return facts
}

func populateReleaseFacts(facts *Facts, rel *release.Release) {
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
}

func releaseNotes(rel *release.Release) string {
	if rel.Info == nil {
		return ""
	}
	return rel.Info.Notes
}

func helmHistoryFacts(history []*release.Release) []HelmRevisionFacts {
	if len(history) == 0 {
		return nil
	}
	facts := make([]HelmRevisionFacts, 0, len(history))
	for _, revision := range history {
		if revision != nil {
			facts = append(facts, helmRevisionFacts(revision))
		}
	}
	return facts
}

func helmRevisionFacts(revision *release.Release) HelmRevisionFacts {
	facts := HelmRevisionFacts{Revision: revision.Version}
	if revision.Chart != nil && revision.Chart.Metadata != nil {
		facts.Chart = chartName(revision)
		facts.AppVersion = revision.Chart.Metadata.AppVersion
	}
	if revision.Info != nil {
		facts.Status = revision.Info.Status.String()
		facts.Description = revision.Info.Description
		if !revision.Info.LastDeployed.IsZero() {
			updated := metav1.NewTime(revision.Info.LastDeployed.Time)
			facts.Updated = &updated
		}
	}
	return facts
}

func statusPresentation(rawStatus, description string) resourcemodel.ResourceStatusPresentation {
	state := strings.TrimSpace(rawStatus)
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
		Message:      description,
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
