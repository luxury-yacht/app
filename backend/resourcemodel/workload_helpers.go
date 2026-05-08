package resourcemodel

import (
	"fmt"
	"strconv"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func workloadResourceModel(
	clusterID, group, version, kind, resource string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return ResourceModel{
		Ref: ResourceRef{
			ClusterID: clusterID,
			Group:     group,
			Version:   version,
			Kind:      kind,
			Resource:  resource,
			Namespace: meta.Namespace,
			Name:      meta.Name,
			UID:       string(meta.UID),
		},
		Source: ResourceSourceKubernetes,
		Scope:  ResourceScopeNamespaced,
		Metadata: ResourceMetadata{
			Labels:            copyStringMap(meta.Labels),
			Annotations:       copyStringMap(meta.Annotations),
			CreationTimestamp: meta.CreationTimestamp,
			ResourceVersion:   meta.ResourceVersion,
			Finalizers:        append([]string(nil), meta.Finalizers...),
		},
		Status: status,
		Facts:  facts,
	}
}

func replicaStatusPresentation(facts WorkloadFacts, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	state := replicaState(facts)
	if facts.DesiredReplicas == 0 {
		return workloadSourceStatus("Scaled to 0", state, "ScaledToZero", "", "inactive", signals, lifecycle)
	}
	if facts.ReadyReplicas >= facts.DesiredReplicas {
		return workloadSourceStatus("Running", state, "", "", "ready", signals, lifecycle)
	}
	if facts.ReadyReplicas > 0 || facts.UpdatedReplicas > 0 || facts.CurrentReplicas > 0 {
		return workloadSourceStatus("Updating", state, "", "", "warning", signals, lifecycle)
	}
	return workloadSourceStatus("Pending", state, "", "", "warning", signals, lifecycle)
}

func deletingWorkloadStatus(meta metav1.ObjectMeta, state string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) (ResourceStatusPresentation, bool) {
	if meta.DeletionTimestamp == nil {
		return ResourceStatusPresentation{}, false
	}
	deletionTimestamp := meta.DeletionTimestamp.Time.Format(time.RFC3339)
	return workloadSourceStatus(
		"Terminating",
		state,
		"DeletionTimestamp",
		"",
		"terminating",
		append(signals, ResourceStatusSignal{Type: StatusSignalDeletion, Name: "metadata.deletionTimestamp", Status: deletionTimestamp}),
		lifecycle,
	), true
}

func workloadConditionStatus(name, state, reason, message, label, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	return ResourceStatusPresentation{
		Label:        label,
		State:        state,
		Presentation: presentation,
		Reason:       firstNonEmpty(reason, name),
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func workloadSourceStatus(label, state, reason, message, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	return ResourceStatusPresentation{
		Label:        label,
		State:        state,
		Presentation: presentation,
		Reason:       reason,
		Message:      message,
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func replicaState(facts WorkloadFacts) string {
	return fmt.Sprintf("%d/%d", facts.ReadyReplicas, facts.DesiredReplicas)
}

func jobState(facts WorkloadFacts) string {
	return fmt.Sprintf("%d/%d", facts.Succeeded, facts.DesiredReplicas)
}

func workloadReplicaSignals(facts WorkloadFacts) []ResourceStatusSignal {
	return []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.replicas", Status: strconv.FormatInt(int64(facts.DesiredReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.replicas", Status: strconv.FormatInt(int64(facts.CurrentReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.readyReplicas", Status: strconv.FormatInt(int64(facts.ReadyReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.updatedReplicas", Status: strconv.FormatInt(int64(facts.UpdatedReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.availableReplicas", Status: strconv.FormatInt(int64(facts.AvailableReplicas), 10)},
	}
}

func workloadLifecycle(meta metav1.ObjectMeta) ResourceLifecycle {
	return ResourceLifecycle{
		Deleting:         meta.DeletionTimestamp != nil,
		FinalizerBlocked: meta.DeletionTimestamp != nil && len(meta.Finalizers) > 0,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
