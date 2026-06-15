package resourcemodel

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func BuildReplicaSetResourceModel(clusterID string, replicaSet *appsv1.ReplicaSet) ResourceModel {
	facts := BuildReplicaSetFacts(replicaSet)
	status := BuildReplicaSetStatusPresentation(replicaSet)
	return WorkloadResourceModel(clusterID, "apps", "v1", "ReplicaSet", "replicasets", replicaSet.ObjectMeta, status, ResourceFacts{ReplicaSet: &facts})
}

func BuildReplicaSetFacts(replicaSet *appsv1.ReplicaSet) ReplicaSetFacts {
	desired := int32(0)
	if replicaSet.Spec.Replicas != nil {
		desired = *replicaSet.Spec.Replicas
	}
	common := WorkloadCommonFacts{
		DesiredReplicas:   desired,
		CurrentReplicas:   replicaSet.Status.Replicas,
		ReadyReplicas:     replicaSet.Status.ReadyReplicas,
		AvailableReplicas: replicaSet.Status.AvailableReplicas,
		Conditions:        replicaSetConditionFacts(replicaSet.Status.Conditions),
	}

	var selector map[string]string
	if replicaSet.Spec.Selector != nil {
		selector = replicaSet.Spec.Selector.MatchLabels
	}

	return ReplicaSetFacts{
		WorkloadCommonFacts: common,
		PodTemplateFacts:    BuildPodTemplateFacts(replicaSet.Spec.Template),
		MinReadySeconds:     replicaSet.Spec.MinReadySeconds,
		Selector:            selector,
		ObservedGeneration:  replicaSet.Status.ObservedGeneration,
		ReadySummary:        replicaSetReadySummary(common),
	}
}

// replicaSetReadySummary is the short details string for a ReplicaSet.
func replicaSetReadySummary(common WorkloadCommonFacts) string {
	summary := fmt.Sprintf("Ready: %d/%d", common.ReadyReplicas, common.DesiredReplicas)
	if common.AvailableReplicas > 0 {
		summary += fmt.Sprintf(", Available: %d", common.AvailableReplicas)
	}
	return summary
}

func BuildReplicaSetStatusPresentation(replicaSet *appsv1.ReplicaSet) ResourceStatusPresentation {
	facts := BuildReplicaSetFacts(replicaSet)
	signals := WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, replicaSetSignals(replicaSet)...)
	lifecycle := WorkloadLifecycle(replicaSet.ObjectMeta)
	if status, ok := DeletingWorkloadStatus(replicaSet.ObjectMeta, ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	if failed := findReplicaSetCondition(replicaSet, appsv1.ReplicaSetReplicaFailure); failed != nil && failed.Status == corev1.ConditionTrue {
		return WorkloadConditionStatus("ReplicaFailure", string(failed.Status), failed.Reason, failed.Message, "Replica failure", "error", signals, lifecycle)
	}
	return ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func replicaSetSignals(replicaSet *appsv1.ReplicaSet) []ResourceStatusSignal {
	signals := make([]ResourceStatusSignal, 0, len(replicaSet.Status.Conditions))
	for _, condition := range replicaSet.Status.Conditions {
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

func replicaSetConditionFacts(conditions []appsv1.ReplicaSetCondition) []ConditionFacts {
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

func findReplicaSetCondition(replicaSet *appsv1.ReplicaSet, conditionType appsv1.ReplicaSetConditionType) *appsv1.ReplicaSetCondition {
	for i := range replicaSet.Status.Conditions {
		if replicaSet.Status.Conditions[i].Type == conditionType {
			return &replicaSet.Status.Conditions[i]
		}
	}
	return nil
}
