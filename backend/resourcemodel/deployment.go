package resourcemodel

import (
	"fmt"
	"strconv"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func BuildDeploymentResourceModel(clusterID string, deployment *appsv1.Deployment) ResourceModel {
	facts := BuildDeploymentFacts(deployment)
	status := BuildDeploymentStatusPresentation(deployment)
	return WorkloadResourceModel(clusterID, "apps", "v1", "Deployment", "deployments", deployment.ObjectMeta, status, ResourceFacts{Deployment: &facts})
}

func BuildDeploymentFacts(deployment *appsv1.Deployment) DeploymentFacts {
	desired := int32(0)
	if deployment.Spec.Replicas != nil {
		desired = *deployment.Spec.Replicas
	}
	common := WorkloadCommonFacts{
		DesiredReplicas:   desired,
		CurrentReplicas:   deployment.Status.Replicas,
		ReadyReplicas:     deployment.Status.ReadyReplicas,
		UpdatedReplicas:   deployment.Status.UpdatedReplicas,
		AvailableReplicas: deployment.Status.AvailableReplicas,
		Conditions:        deploymentConditionFacts(deployment.Status.Conditions),
	}
	maxSurge, maxUnavailable := deploymentRolloutParameters(deployment)
	rolloutStatus, rolloutMessage := deploymentRolloutState(deployment)

	var selector map[string]string
	if deployment.Spec.Selector != nil {
		selector = deployment.Spec.Selector.MatchLabels
	}

	return DeploymentFacts{
		WorkloadCommonFacts: common,
		PodTemplateFacts:    BuildPodTemplateFacts(deployment.Spec.Template),
		Paused:              deployment.Spec.Paused,
		Strategy:            string(deployment.Spec.Strategy.Type),
		MaxSurge:            maxSurge,
		MaxUnavailable:      maxUnavailable,
		MinReadySeconds:     deployment.Spec.MinReadySeconds,
		RevisionHistory:     Int32PtrValue(deployment.Spec.RevisionHistoryLimit),
		ProgressDeadline:    Int32PtrValue(deployment.Spec.ProgressDeadlineSeconds),
		ObservedGeneration:  deployment.Status.ObservedGeneration,
		Selector:            selector,
		ReadySummary:        deploymentReadySummary(common),
		RolloutStatus:       rolloutStatus,
		RolloutMessage:      rolloutMessage,
	}
}

func Int32PtrValue(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

// deploymentRolloutParameters formats the rolling-update surge/unavailable knobs.
func deploymentRolloutParameters(deployment *appsv1.Deployment) (maxSurge, maxUnavailable string) {
	if ru := deployment.Spec.Strategy.RollingUpdate; ru != nil {
		if ru.MaxSurge != nil {
			maxSurge = ru.MaxSurge.String()
		}
		if ru.MaxUnavailable != nil {
			maxUnavailable = ru.MaxUnavailable.String()
		}
	}
	return maxSurge, maxUnavailable
}

// deploymentRolloutState derives the rollout status/message from the deployment's
// Progressing/Available conditions.
func deploymentRolloutState(deployment *appsv1.Deployment) (rolloutStatus, rolloutMessage string) {
	for _, cond := range deployment.Status.Conditions {
		if cond.Type == appsv1.DeploymentProgressing {
			switch cond.Status {
			case corev1.ConditionTrue:
				rolloutStatus = "progressing"
				rolloutMessage = cond.Message
			case corev1.ConditionFalse:
				rolloutStatus = "failed"
				rolloutMessage = cond.Message
			}
		} else if cond.Type == appsv1.DeploymentAvailable && cond.Status == corev1.ConditionTrue && rolloutStatus == "" {
			rolloutStatus = "complete"
		}
	}
	return rolloutStatus, rolloutMessage
}

// deploymentReadySummary is the short "Ready: x/y" details string.
func deploymentReadySummary(common WorkloadCommonFacts) string {
	summary := fmt.Sprintf("Ready: %d/%d", common.ReadyReplicas, common.DesiredReplicas)
	if common.UpdatedReplicas != common.CurrentReplicas {
		summary += fmt.Sprintf(", Updated: %d", common.UpdatedReplicas)
	}
	return summary
}

func BuildDeploymentStatusPresentation(deployment *appsv1.Deployment) ResourceStatusPresentation {
	facts := BuildDeploymentFacts(deployment)
	signals := WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, deploymentSignals(deployment)...)
	lifecycle := WorkloadLifecycle(deployment.ObjectMeta)

	if status, ok := DeletingWorkloadStatus(deployment.ObjectMeta, ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
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
	return ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
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
