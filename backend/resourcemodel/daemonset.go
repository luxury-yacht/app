package resourcemodel

import appsv1 "k8s.io/api/apps/v1"

func BuildDaemonSetResourceModel(clusterID string, daemonSet *appsv1.DaemonSet) ResourceModel {
	facts := BuildDaemonSetFacts(daemonSet)
	status := BuildDaemonSetStatusPresentation(daemonSet)
	return workloadResourceModel(clusterID, "apps", "v1", "DaemonSet", "daemonsets", daemonSet.ObjectMeta, status, ResourceFacts{DaemonSet: &facts})
}

func BuildDaemonSetFacts(daemonSet *appsv1.DaemonSet) WorkloadFacts {
	return WorkloadFacts{
		DesiredReplicas:   daemonSet.Status.DesiredNumberScheduled,
		CurrentReplicas:   daemonSet.Status.CurrentNumberScheduled,
		ReadyReplicas:     daemonSet.Status.NumberReady,
		UpdatedReplicas:   daemonSet.Status.UpdatedNumberScheduled,
		AvailableReplicas: daemonSet.Status.NumberAvailable,
		Conditions:        daemonSetConditionFacts(daemonSet.Status.Conditions),
	}
}

func BuildDaemonSetStatusPresentation(daemonSet *appsv1.DaemonSet) ResourceStatusPresentation {
	facts := BuildDaemonSetFacts(daemonSet)
	signals := workloadReplicaSignals(facts)
	signals = append(signals, daemonSetSignals(daemonSet)...)
	lifecycle := workloadLifecycle(daemonSet.ObjectMeta)
	if status, ok := deletingWorkloadStatus(daemonSet.ObjectMeta, replicaState(facts), signals, lifecycle); ok {
		return status
	}
	return replicaStatusPresentation(facts, signals, lifecycle)
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
