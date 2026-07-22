/*
 * backend/resources/deployment/model.go
 *
 * Deployment resource model: the single definition of a Deployment's intrinsic
 * fields + status presentation. Detail/object-map projections derive from it.
 */

package deployment

import (
	"fmt"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the Deployment resource model. Facts are owned by
// this package (deployment.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, deployment *appsv1.Deployment) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(deployment)
	return resourcemodel.KubernetesResourceModel(clusterID, "apps", "v1", "Deployment", "deployments", resourcemodel.ResourceScopeNamespaced, deployment.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Deployment facts from the raw object.
func BuildFacts(deployment *appsv1.Deployment) Facts {
	desired := int32(0)
	if deployment.Spec.Replicas != nil {
		desired = *deployment.Spec.Replicas
	}
	common := resourcemodel.WorkloadCommonFacts{
		DesiredReplicas:   desired,
		CurrentReplicas:   deployment.Status.Replicas,
		ReadyReplicas:     deployment.Status.ReadyReplicas,
		UpdatedReplicas:   deployment.Status.UpdatedReplicas,
		AvailableReplicas: deployment.Status.AvailableReplicas,
		Conditions:        conditionFacts(deployment.Status.Conditions),
	}
	maxSurge, maxUnavailable := rolloutParameters(deployment)
	rolloutStatus, rolloutMessage := rolloutState(deployment)

	var selector map[string]string
	if deployment.Spec.Selector != nil {
		selector = deployment.Spec.Selector.MatchLabels
	}

	return Facts{
		WorkloadCommonFacts: common,
		PodTemplateFacts:    resourcemodel.BuildPodTemplateFacts(deployment.Spec.Template),
		Paused:              deployment.Spec.Paused,
		Strategy:            string(deployment.Spec.Strategy.Type),
		MaxSurge:            maxSurge,
		MaxUnavailable:      maxUnavailable,
		MinReadySeconds:     deployment.Spec.MinReadySeconds,
		RevisionHistory:     resourcemodel.Int32PtrValue(deployment.Spec.RevisionHistoryLimit),
		ProgressDeadline:    resourcemodel.Int32PtrValue(deployment.Spec.ProgressDeadlineSeconds),
		ObservedGeneration:  deployment.Status.ObservedGeneration,
		Selector:            selector,
		ReadySummary:        readySummary(common),
		RolloutStatus:       rolloutStatus,
		RolloutMessage:      rolloutMessage,
	}
}

// rolloutParameters formats the rolling-update surge/unavailable knobs.
func rolloutParameters(deployment *appsv1.Deployment) (maxSurge, maxUnavailable string) {
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

// rolloutState derives the rollout status/message from Progressing/Available.
func rolloutState(deployment *appsv1.Deployment) (rolloutStatus, rolloutMessage string) {
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

// readySummary is the short "Ready: x/y" details string.
func readySummary(common resourcemodel.WorkloadCommonFacts) string {
	summary := fmt.Sprintf("Ready: %d/%d", common.ReadyReplicas, common.DesiredReplicas)
	if common.UpdatedReplicas != common.CurrentReplicas {
		summary += fmt.Sprintf(", Updated: %d", common.UpdatedReplicas)
	}
	return summary
}

// BuildStatusPresentation derives the Deployment status presentation.
func BuildStatusPresentation(deployment *appsv1.Deployment) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(deployment)
	signals := resourcemodel.WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, statusSignals(deployment)...)
	lifecycle := resourcemodel.ObjectLifecycle(deployment.ObjectMeta)

	if status, ok := resourcemodel.DeletingObjectStatus(deployment.ObjectMeta, resourcemodel.ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	if failed := findCondition(deployment, appsv1.DeploymentReplicaFailure); failed != nil && failed.Status == corev1.ConditionTrue {
		return resourcemodel.WorkloadConditionStatus("ReplicaFailure", string(failed.Status), failed.Reason, failed.Message, "Replica failure", "error", signals, lifecycle)
	}
	if progressing := findCondition(deployment, appsv1.DeploymentProgressing); progressing != nil && progressing.Status == corev1.ConditionFalse {
		return resourcemodel.WorkloadConditionStatus("Progressing", string(progressing.Status), progressing.Reason, progressing.Message, "Progress deadline", "error", signals, lifecycle)
	}
	if deployment.Spec.Paused {
		return resourcemodel.ObjectSourceStatus("Paused", "true", "SpecPaused", "", "warning", signals, lifecycle)
	}
	return resourcemodel.ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func statusSignals(deployment *appsv1.Deployment) []resourcemodel.ResourceStatusSignal {
	signals := []resourcemodel.ResourceStatusSignal{{Type: resourcemodel.StatusSignalResourceState, Name: "spec.paused", Status: strconv.FormatBool(deployment.Spec.Paused)}}
	for _, condition := range deployment.Status.Conditions {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
			Name:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return signals
}

func conditionFacts(conditions []appsv1.DeploymentCondition) []resourcemodel.ConditionFacts {
	facts := make([]resourcemodel.ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, resourcemodel.ConditionFacts{
			Type:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return facts
}

func findCondition(deployment *appsv1.Deployment, conditionType appsv1.DeploymentConditionType) *appsv1.DeploymentCondition {
	for i := range deployment.Status.Conditions {
		if deployment.Status.Conditions[i].Type == conditionType {
			return &deployment.Status.Conditions[i]
		}
	}
	return nil
}
