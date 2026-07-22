package resourcemodel

import (
	"fmt"
	"strconv"
)

func ReplicaStatusPresentation(facts WorkloadCommonFacts, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	state := ReplicaState(facts)
	if facts.DesiredReplicas == 0 {
		return ObjectSourceStatus("Scaled to 0", state, "ScaledToZero", "", "inactive", signals, lifecycle)
	}
	if facts.ReadyReplicas >= facts.DesiredReplicas {
		return ObjectSourceStatus("Running", state, "", "", "ready", signals, lifecycle)
	}
	if facts.ReadyReplicas > 0 || facts.UpdatedReplicas > 0 || facts.CurrentReplicas > 0 {
		return ObjectSourceStatus("Updating", state, "", "", "warning", signals, lifecycle)
	}
	return ObjectSourceStatus("Pending", state, "", "", "warning", signals, lifecycle)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
