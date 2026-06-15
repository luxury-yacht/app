package resourcemodel

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
)

func BuildDaemonSetResourceModel(clusterID string, daemonSet *appsv1.DaemonSet) ResourceModel {
	facts := BuildDaemonSetFacts(daemonSet)
	status := BuildDaemonSetStatusPresentation(daemonSet)
	return WorkloadResourceModel(clusterID, "apps", "v1", "DaemonSet", "daemonsets", daemonSet.ObjectMeta, status, ResourceFacts{DaemonSet: &facts})
}

func BuildDaemonSetFacts(daemonSet *appsv1.DaemonSet) DaemonSetFacts {
	common := WorkloadCommonFacts{
		DesiredReplicas:   daemonSet.Status.DesiredNumberScheduled,
		CurrentReplicas:   daemonSet.Status.CurrentNumberScheduled,
		ReadyReplicas:     daemonSet.Status.NumberReady,
		UpdatedReplicas:   daemonSet.Status.UpdatedNumberScheduled,
		AvailableReplicas: daemonSet.Status.NumberAvailable,
		Conditions:        daemonSetConditionFacts(daemonSet.Status.Conditions),
	}

	var maxUnavailable, maxSurge string
	if ru := daemonSet.Spec.UpdateStrategy.RollingUpdate; ru != nil {
		if ru.MaxUnavailable != nil {
			maxUnavailable = ru.MaxUnavailable.String()
		}
		if ru.MaxSurge != nil {
			maxSurge = ru.MaxSurge.String()
		}
	}

	var selector map[string]string
	if daemonSet.Spec.Selector != nil {
		selector = daemonSet.Spec.Selector.MatchLabels
	}

	return DaemonSetFacts{
		WorkloadCommonFacts:  common,
		PodTemplateFacts:     BuildPodTemplateFacts(daemonSet.Spec.Template),
		UpdateStrategy:       string(daemonSet.Spec.UpdateStrategy.Type),
		MaxUnavailable:       maxUnavailable,
		MaxSurge:             maxSurge,
		MinReadySeconds:      daemonSet.Spec.MinReadySeconds,
		RevisionHistoryLimit: Int32PtrValue(daemonSet.Spec.RevisionHistoryLimit),
		Selector:             selector,
		ObservedGeneration:   daemonSet.Status.ObservedGeneration,
		NumberMisscheduled:   daemonSet.Status.NumberMisscheduled,
		CollisionCount:       daemonSet.Status.CollisionCount,
		ReadySummary:         daemonSetReadySummary(daemonSet),
	}
}

// daemonSetReadySummary is the short details string for a DaemonSet.
func daemonSetReadySummary(daemonSet *appsv1.DaemonSet) string {
	summary := fmt.Sprintf("Desired: %d, Current: %d, Ready: %d", daemonSet.Status.DesiredNumberScheduled, daemonSet.Status.CurrentNumberScheduled, daemonSet.Status.NumberReady)
	if daemonSet.Status.NumberUnavailable > 0 {
		summary += fmt.Sprintf(", Unavailable: %d", daemonSet.Status.NumberUnavailable)
	}
	if daemonSet.Status.NumberMisscheduled > 0 {
		summary += fmt.Sprintf(", Misscheduled: %d", daemonSet.Status.NumberMisscheduled)
	}
	return summary
}

func BuildDaemonSetStatusPresentation(daemonSet *appsv1.DaemonSet) ResourceStatusPresentation {
	facts := BuildDaemonSetFacts(daemonSet)
	signals := WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, daemonSetSignals(daemonSet)...)
	lifecycle := WorkloadLifecycle(daemonSet.ObjectMeta)
	if status, ok := DeletingWorkloadStatus(daemonSet.ObjectMeta, ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	return ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func daemonSetSignals(daemonSet *appsv1.DaemonSet) []ResourceStatusSignal {
	signals := make([]ResourceStatusSignal, 0, len(daemonSet.Status.Conditions))
	for _, condition := range daemonSet.Status.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return signals
}

func daemonSetConditionFacts(conditions []appsv1.DaemonSetCondition) []ConditionFacts {
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return facts
}
