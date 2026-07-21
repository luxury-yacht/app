/*
 * backend/resources/replicaset/model.go
 *
 * ReplicaSet resource model: the single definition of a ReplicaSet's intrinsic
 * fields + status presentation. Detail/object-map projections derive from it.
 */

package replicaset

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the ReplicaSet resource model. Facts are owned by
// this package (replicaset.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, replicaSet *appsv1.ReplicaSet) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(replicaSet)
	return resourcemodel.KubernetesResourceModel(clusterID, "apps", "v1", "ReplicaSet", "replicasets", resourcemodel.ResourceScopeNamespaced, replicaSet.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the ReplicaSet facts from the raw object.
func BuildFacts(replicaSet *appsv1.ReplicaSet) Facts {
	desired := int32(0)
	if replicaSet.Spec.Replicas != nil {
		desired = *replicaSet.Spec.Replicas
	}
	common := resourcemodel.WorkloadCommonFacts{
		DesiredReplicas:   desired,
		CurrentReplicas:   replicaSet.Status.Replicas,
		ReadyReplicas:     replicaSet.Status.ReadyReplicas,
		AvailableReplicas: replicaSet.Status.AvailableReplicas,
		Conditions:        conditionFacts(replicaSet.Status.Conditions),
	}

	var selector map[string]string
	if replicaSet.Spec.Selector != nil {
		selector = replicaSet.Spec.Selector.MatchLabels
	}

	return Facts{
		WorkloadCommonFacts: common,
		PodTemplateFacts:    resourcemodel.BuildPodTemplateFacts(replicaSet.Spec.Template),
		MinReadySeconds:     replicaSet.Spec.MinReadySeconds,
		Selector:            selector,
		ObservedGeneration:  replicaSet.Status.ObservedGeneration,
		ReadySummary:        readySummary(common),
	}
}

// readySummary is the short details string for a ReplicaSet.
func readySummary(common resourcemodel.WorkloadCommonFacts) string {
	summary := fmt.Sprintf("Ready: %d/%d", common.ReadyReplicas, common.DesiredReplicas)
	if common.AvailableReplicas > 0 {
		summary += fmt.Sprintf(", Available: %d", common.AvailableReplicas)
	}
	return summary
}

// BuildStatusPresentation derives the ReplicaSet status presentation.
func BuildStatusPresentation(replicaSet *appsv1.ReplicaSet) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(replicaSet)
	signals := resourcemodel.WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, statusSignals(replicaSet)...)
	lifecycle := resourcemodel.ObjectLifecycle(replicaSet.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(replicaSet.ObjectMeta, resourcemodel.ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	if failed := findCondition(replicaSet, appsv1.ReplicaSetReplicaFailure); failed != nil && failed.Status == corev1.ConditionTrue {
		return resourcemodel.WorkloadConditionStatus("ReplicaFailure", string(failed.Status), failed.Reason, failed.Message, "Replica failure", "error", signals, lifecycle)
	}
	return resourcemodel.ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func statusSignals(replicaSet *appsv1.ReplicaSet) []resourcemodel.ResourceStatusSignal {
	signals := make([]resourcemodel.ResourceStatusSignal, 0, len(replicaSet.Status.Conditions))
	for _, condition := range replicaSet.Status.Conditions {
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

func conditionFacts(conditions []appsv1.ReplicaSetCondition) []resourcemodel.ConditionFacts {
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

func findCondition(replicaSet *appsv1.ReplicaSet, conditionType appsv1.ReplicaSetConditionType) *appsv1.ReplicaSetCondition {
	for i := range replicaSet.Status.Conditions {
		if replicaSet.Status.Conditions[i].Type == conditionType {
			return &replicaSet.Status.Conditions[i]
		}
	}
	return nil
}
