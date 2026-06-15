/*
 * backend/resources/namespaces/model.go
 *
 * Namespace resource model: the single definition of a Namespace's intrinsic fields
 * + status presentation. Quota/limit links materialize only when requested. Shared
 * model helpers are reused from resourcemodel (exported network base).
 */

package namespaces

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// BuildResourceModel builds the Namespace resource model. Facts are owned by this
// package (namespaces.Facts); callers needing facts use BuildFacts. Workload presence
// + quota/limit names are supplied by the caller (they require list scans).
func BuildResourceModel(clusterID string, namespace *corev1.Namespace, hasWorkloads, workloadsKnown bool, resourceQuotaNames, limitRangeNames []string, options ...resourcemodel.ResourceModelBuildOptions) resourcemodel.ResourceModel {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := BuildFacts(clusterID, namespace, hasWorkloads, workloadsKnown, resourceQuotaNames, limitRangeNames, buildOptions)
	status := statusPresentation(namespace, facts)
	meta := metav1.ObjectMeta{}
	if namespace != nil {
		meta = namespace.ObjectMeta
	}
	return resourcemodel.NetworkResourceModel(clusterID, "", "v1", "Namespace", "namespaces", resourcemodel.ResourceScopeCluster, meta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Namespace facts. Quota/limit links materialize only when
// the relationship or detail materialization flags are set.
func BuildFacts(clusterID string, namespace *corev1.Namespace, hasWorkloads, workloadsKnown bool, resourceQuotaNames, limitRangeNames []string, options resourcemodel.ResourceModelBuildOptions) Facts {
	facts := Facts{
		WorkloadsKnown: workloadsKnown,
		HasWorkloads:   hasWorkloads,
		WorkloadState:  workloadState(hasWorkloads, workloadsKnown),
	}
	if namespace != nil {
		facts.RawPhase = string(namespace.Status.Phase)
	}
	if options.Materialization.Has(resourcemodel.MaterializeRelationshipFacts) || options.Materialization.Has(resourcemodel.MaterializeDetailFacts) {
		namespaceName := ""
		if namespace != nil {
			namespaceName = namespace.Name
		}
		facts.ResourceQuotas = namespacedNameLinks(clusterID, "", "v1", "ResourceQuota", "resourcequotas", namespaceName, resourceQuotaNames)
		facts.LimitRanges = namespacedNameLinks(clusterID, "", "v1", "LimitRange", "limitranges", namespaceName, limitRangeNames)
	}
	return facts
}

func statusPresentation(namespace *corev1.Namespace, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strings.TrimSpace(facts.RawPhase)
	if state == "" {
		state = "Unknown"
	}
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalPhase,
		Name:   "status.phase",
		Status: state,
	}}
	if facts.WorkloadState != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:   resourcemodel.StatusSignalResourceState,
			Name:   "workloads",
			Status: facts.WorkloadState,
		})
	}
	meta := metav1.ObjectMeta{}
	if namespace != nil {
		meta = namespace.ObjectMeta
	}
	lifecycle := resourcemodel.NetworkLifecycle(meta)
	if namespace != nil {
		if status, ok := resourcemodel.DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
			return status
		}
	}
	presentation := "unknown"
	if strings.EqualFold(state, string(corev1.NamespaceActive)) {
		presentation = "ready"
	} else if strings.EqualFold(state, string(corev1.NamespaceTerminating)) {
		presentation = "terminating"
	} else if !strings.EqualFold(state, "Unknown") {
		presentation = "warning"
	}
	return resourcemodel.NetworkSourceStatus(state, state, "status.phase", presentation, signals, lifecycle)
}

func workloadState(hasWorkloads, workloadsKnown bool) string {
	if !workloadsKnown {
		return workloadStateUnknown
	}
	if hasWorkloads {
		return workloadStatePresent
	}
	return workloadStateNone
}

func namespacedNameLinks(clusterID, group, version, kind, resource, namespace string, names []string) []resourcemodel.ResourceLink {
	if len(names) == 0 || namespace == "" {
		return nil
	}
	links := make([]resourcemodel.ResourceLink, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		links = append(links, resourcemodel.NewNamespacedResourceLink(clusterID, group, version, kind, resource, namespace, name, ""))
	}
	resourcemodel.SortResourceLinksByObjectName(links)
	return links
}
