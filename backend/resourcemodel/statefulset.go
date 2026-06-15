package resourcemodel

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
)

func BuildStatefulSetResourceModel(clusterID string, statefulSet *appsv1.StatefulSet) ResourceModel {
	facts := BuildStatefulSetFacts(statefulSet)
	status := BuildStatefulSetStatusPresentation(statefulSet)
	return workloadResourceModel(clusterID, "apps", "v1", "StatefulSet", "statefulsets", statefulSet.ObjectMeta, status, ResourceFacts{StatefulSet: &facts})
}

func BuildStatefulSetFacts(statefulSet *appsv1.StatefulSet) StatefulSetFacts {
	desired := int32(0)
	if statefulSet.Spec.Replicas != nil {
		desired = *statefulSet.Spec.Replicas
	}
	common := WorkloadCommonFacts{
		DesiredReplicas:   desired,
		CurrentReplicas:   statefulSet.Status.Replicas,
		ReadyReplicas:     statefulSet.Status.ReadyReplicas,
		UpdatedReplicas:   statefulSet.Status.UpdatedReplicas,
		AvailableReplicas: statefulSet.Status.AvailableReplicas,
		Conditions:        statefulSetConditionFacts(statefulSet.Status.Conditions),
	}

	maxUnavailable := ""
	var partition *int32
	if ru := statefulSet.Spec.UpdateStrategy.RollingUpdate; ru != nil {
		if ru.MaxUnavailable != nil {
			maxUnavailable = ru.MaxUnavailable.String()
		}
		partition = ru.Partition
	}

	var selector map[string]string
	if statefulSet.Spec.Selector != nil {
		selector = statefulSet.Spec.Selector.MatchLabels
	}

	return StatefulSetFacts{
		WorkloadCommonFacts:   common,
		PodTemplateFacts:      BuildPodTemplateFacts(statefulSet.Spec.Template),
		UpdateStrategy:        string(statefulSet.Spec.UpdateStrategy.Type),
		Partition:             partition,
		MaxUnavailable:        maxUnavailable,
		PodManagementPolicy:   string(statefulSet.Spec.PodManagementPolicy),
		MinReadySeconds:       statefulSet.Spec.MinReadySeconds,
		RevisionHistoryLimit:  int32PtrValue(statefulSet.Spec.RevisionHistoryLimit),
		ServiceName:           statefulSet.Spec.ServiceName,
		Selector:              selector,
		StatusCurrentRevision: statefulSet.Status.CurrentRevision,
		StatusUpdateRevision:  statefulSet.Status.UpdateRevision,
		StatusCurrentReplicas: statefulSet.Status.CurrentReplicas,
		ObservedGeneration:    statefulSet.Status.ObservedGeneration,
		CollisionCount:        statefulSet.Status.CollisionCount,
		ReadySummary:          statefulSetReadySummary(statefulSet, common),
	}
}

// statefulSetReadySummary is the short details string for a StatefulSet.
func statefulSetReadySummary(statefulSet *appsv1.StatefulSet, common WorkloadCommonFacts) string {
	replicaInfo := fmt.Sprintf("Ready: %d/%d", common.ReadyReplicas, common.CurrentReplicas)
	if statefulSet.Spec.Replicas != nil && *statefulSet.Spec.Replicas != common.CurrentReplicas {
		replicaInfo = fmt.Sprintf("Ready: %d/%d (desired: %d)", common.ReadyReplicas, common.CurrentReplicas, *statefulSet.Spec.Replicas)
	}
	serviceInfo := fmt.Sprintf(", Service: %s", statefulSet.Spec.ServiceName)
	volumeInfo := ""
	if len(statefulSet.Spec.VolumeClaimTemplates) > 0 {
		volumeInfo = fmt.Sprintf(", %d PVC template(s)", len(statefulSet.Spec.VolumeClaimTemplates))
	}
	return fmt.Sprintf("%s%s%s", replicaInfo, serviceInfo, volumeInfo)
}

func BuildStatefulSetStatusPresentation(statefulSet *appsv1.StatefulSet) ResourceStatusPresentation {
	facts := BuildStatefulSetFacts(statefulSet)
	signals := workloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, statefulSetSignals(statefulSet)...)
	lifecycle := workloadLifecycle(statefulSet.ObjectMeta)
	if status, ok := deletingWorkloadStatus(statefulSet.ObjectMeta, replicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	return replicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func statefulSetSignals(statefulSet *appsv1.StatefulSet) []ResourceStatusSignal {
	signals := make([]ResourceStatusSignal, 0, len(statefulSet.Status.Conditions))
	for _, condition := range statefulSet.Status.Conditions {
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

func statefulSetConditionFacts(conditions []appsv1.StatefulSetCondition) []ConditionFacts {
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
