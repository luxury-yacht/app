package resourcemodel

import (
	"fmt"
	"strconv"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func WorkloadResourceModel(
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

func ReplicaStatusPresentation(facts WorkloadCommonFacts, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	state := ReplicaState(facts)
	if facts.DesiredReplicas == 0 {
		return WorkloadSourceStatus("Scaled to 0", state, "ScaledToZero", "", "inactive", signals, lifecycle)
	}
	if facts.ReadyReplicas >= facts.DesiredReplicas {
		return WorkloadSourceStatus("Running", state, "", "", "ready", signals, lifecycle)
	}
	if facts.ReadyReplicas > 0 || facts.UpdatedReplicas > 0 || facts.CurrentReplicas > 0 {
		return WorkloadSourceStatus("Updating", state, "", "", "warning", signals, lifecycle)
	}
	return WorkloadSourceStatus("Pending", state, "", "", "warning", signals, lifecycle)
}

func DeletingWorkloadStatus(meta metav1.ObjectMeta, state string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) (ResourceStatusPresentation, bool) {
	if meta.DeletionTimestamp == nil {
		return ResourceStatusPresentation{}, false
	}
	deletionTimestamp := meta.DeletionTimestamp.Time.Format(time.RFC3339)
	return WorkloadSourceStatus(
		"Terminating",
		state,
		"DeletionTimestamp",
		"",
		"terminating",
		append(signals, ResourceStatusSignal{Type: StatusSignalDeletion, Name: "metadata.deletionTimestamp", Status: deletionTimestamp}),
		lifecycle,
	), true
}

func WorkloadConditionStatus(name, state, reason, message, label, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	return ResourceStatusPresentation{
		Label:        label,
		State:        state,
		Presentation: presentation,
		Reason:       firstNonEmpty(reason, name),
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func WorkloadSourceStatus(label, state, reason, message, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
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

func ReplicaState(facts WorkloadCommonFacts) string {
	return fmt.Sprintf("%d/%d", facts.ReadyReplicas, facts.DesiredReplicas)
}

// Int32PtrValue dereferences an optional *int32 spec field, treating nil as 0.
// Shared by the workload kinds that surface RevisionHistoryLimit and similar
// pointer-typed fields.
func Int32PtrValue(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

func WorkloadReplicaSignals(facts WorkloadCommonFacts) []ResourceStatusSignal {
	return []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.replicas", Status: strconv.FormatInt(int64(facts.DesiredReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.replicas", Status: strconv.FormatInt(int64(facts.CurrentReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.readyReplicas", Status: strconv.FormatInt(int64(facts.ReadyReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.updatedReplicas", Status: strconv.FormatInt(int64(facts.UpdatedReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.availableReplicas", Status: strconv.FormatInt(int64(facts.AvailableReplicas), 10)},
	}
}

func WorkloadLifecycle(meta metav1.ObjectMeta) ResourceLifecycle {
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
