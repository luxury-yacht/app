package resourcemodel

import (
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	NamespaceWorkloadStateUnknown = "unknown"
	NamespaceWorkloadStateNone    = "none"
	NamespaceWorkloadStatePresent = "present"
)

func BuildNamespaceResourceModel(
	clusterID string,
	namespace *corev1.Namespace,
	hasWorkloads bool,
	workloadsKnown bool,
	resourceQuotaNames []string,
	limitRangeNames []string,
	options ...ResourceModelBuildOptions,
) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildNamespaceFacts(clusterID, namespace, hasWorkloads, workloadsKnown, resourceQuotaNames, limitRangeNames, buildOptions)
	status := BuildNamespaceStatusPresentation(namespace, facts)
	meta := metav1.ObjectMeta{}
	if namespace != nil {
		meta = namespace.ObjectMeta
	}
	return NetworkResourceModel(clusterID, "", "v1", "Namespace", "namespaces", ResourceScopeCluster, meta, status, ResourceFacts{Namespace: &facts})
}

func BuildNamespaceFacts(
	clusterID string,
	namespace *corev1.Namespace,
	hasWorkloads bool,
	workloadsKnown bool,
	resourceQuotaNames []string,
	limitRangeNames []string,
	options ResourceModelBuildOptions,
) NamespaceFacts {
	facts := NamespaceFacts{
		WorkloadsKnown: workloadsKnown,
		HasWorkloads:   hasWorkloads,
		WorkloadState:  namespaceWorkloadState(hasWorkloads, workloadsKnown),
	}
	if namespace != nil {
		facts.RawPhase = string(namespace.Status.Phase)
	}
	if options.Materialization.Has(MaterializeRelationshipFacts) || options.Materialization.Has(MaterializeDetailFacts) {
		namespaceName := ""
		if namespace != nil {
			namespaceName = namespace.Name
		}
		facts.ResourceQuotas = namespacedNameLinks(clusterID, "", "v1", "ResourceQuota", "resourcequotas", namespaceName, resourceQuotaNames)
		facts.LimitRanges = namespacedNameLinks(clusterID, "", "v1", "LimitRange", "limitranges", namespaceName, limitRangeNames)
	}
	return facts
}

func BuildNamespaceStatusPresentation(namespace *corev1.Namespace, facts NamespaceFacts) ResourceStatusPresentation {
	state := strings.TrimSpace(facts.RawPhase)
	if state == "" {
		state = "Unknown"
	}
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalPhase,
		Name:   "status.phase",
		Status: state,
	}}
	if facts.WorkloadState != "" {
		signals = append(signals, ResourceStatusSignal{
			Type:   StatusSignalResourceState,
			Name:   "workloads",
			Status: facts.WorkloadState,
		})
	}
	meta := metav1.ObjectMeta{}
	if namespace != nil {
		meta = namespace.ObjectMeta
	}
	lifecycle := NetworkLifecycle(meta)
	if namespace != nil {
		if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
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
	return NetworkSourceStatus(state, state, "status.phase", presentation, signals, lifecycle)
}

func namespaceWorkloadState(hasWorkloads, workloadsKnown bool) string {
	if !workloadsKnown {
		return NamespaceWorkloadStateUnknown
	}
	if hasWorkloads {
		return NamespaceWorkloadStatePresent
	}
	return NamespaceWorkloadStateNone
}

func namespacedNameLinks(clusterID, group, version, kind, resource, namespace string, names []string) []ResourceLink {
	if len(names) == 0 || namespace == "" {
		return nil
	}
	links := make([]ResourceLink, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		links = append(links, namespacedResourceLink(clusterID, group, version, kind, resource, namespace, name, ""))
	}
	sortResourceLinksByObjectName(links)
	return links
}
