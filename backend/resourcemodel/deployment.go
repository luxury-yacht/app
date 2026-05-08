package resourcemodel

import (
	"strconv"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func BuildDeploymentResourceModel(clusterID string, deployment *appsv1.Deployment) ResourceModel {
	facts := BuildDeploymentFacts(deployment)
	status := BuildDeploymentStatusPresentation(deployment)
	return workloadResourceModel(clusterID, "apps", "v1", "Deployment", "deployments", deployment.ObjectMeta, status, ResourceFacts{Deployment: &facts})
}

func BuildDeploymentFacts(deployment *appsv1.Deployment) DeploymentFacts {
	desired := int32(0)
	if deployment.Spec.Replicas != nil {
		desired = *deployment.Spec.Replicas
	}
	return DeploymentFacts{
		WorkloadCommonFacts: WorkloadCommonFacts{
			DesiredReplicas:   desired,
			CurrentReplicas:   deployment.Status.Replicas,
			ReadyReplicas:     deployment.Status.ReadyReplicas,
			UpdatedReplicas:   deployment.Status.UpdatedReplicas,
			AvailableReplicas: deployment.Status.AvailableReplicas,
			Conditions:        deploymentConditionFacts(deployment.Status.Conditions),
		},
		Paused: deployment.Spec.Paused,
	}
}

func BuildDeploymentStatusPresentation(deployment *appsv1.Deployment) ResourceStatusPresentation {
	facts := BuildDeploymentFacts(deployment)
	signals := workloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, deploymentSignals(deployment)...)
	lifecycle := workloadLifecycle(deployment.ObjectMeta)

	if status, ok := deletingWorkloadStatus(deployment.ObjectMeta, replicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	if failed := findDeploymentCondition(deployment, appsv1.DeploymentReplicaFailure); failed != nil && failed.Status == corev1.ConditionTrue {
		return workloadConditionStatus("ReplicaFailure", string(failed.Status), failed.Reason, failed.Message, "Replica failure", "error", signals, lifecycle)
	}
	if progressing := findDeploymentCondition(deployment, appsv1.DeploymentProgressing); progressing != nil && progressing.Status == corev1.ConditionFalse {
		return workloadConditionStatus("Progressing", string(progressing.Status), progressing.Reason, progressing.Message, "Progress deadline", "error", signals, lifecycle)
	}
	if deployment.Spec.Paused {
		return workloadSourceStatus("Paused", "true", "SpecPaused", "", "warning", signals, lifecycle)
	}
	return replicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func deploymentSignals(deployment *appsv1.Deployment) []ResourceStatusSignal {
	signals := []ResourceStatusSignal{{Type: StatusSignalResourceState, Name: "spec.paused", Status: strconv.FormatBool(deployment.Spec.Paused)}}
	for _, condition := range deployment.Status.Conditions {
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

func deploymentConditionFacts(conditions []appsv1.DeploymentCondition) []ConditionFacts {
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

func findDeploymentCondition(deployment *appsv1.Deployment, conditionType appsv1.DeploymentConditionType) *appsv1.DeploymentCondition {
	for i := range deployment.Status.Conditions {
		if deployment.Status.Conditions[i].Type == conditionType {
			return &deployment.Status.Conditions[i]
		}
	}
	return nil
}
