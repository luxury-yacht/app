package resourcemodel

import appsv1 "k8s.io/api/apps/v1"

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
	return StatefulSetFacts{
		WorkloadCommonFacts: WorkloadCommonFacts{
			DesiredReplicas:   desired,
			CurrentReplicas:   statefulSet.Status.Replicas,
			ReadyReplicas:     statefulSet.Status.ReadyReplicas,
			UpdatedReplicas:   statefulSet.Status.UpdatedReplicas,
			AvailableReplicas: statefulSet.Status.AvailableReplicas,
			Conditions:        statefulSetConditionFacts(statefulSet.Status.Conditions),
		},
	}
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
