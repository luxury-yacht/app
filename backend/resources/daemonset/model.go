/*
 * backend/resources/daemonset/model.go
 *
 * DaemonSet resource model: the single definition of a DaemonSet's intrinsic
 * fields + status presentation. Detail/object-map projections derive from it.
 */

package daemonset

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
)

// BuildResourceModel builds the DaemonSet resource model. Facts are owned by
// this package (daemonset.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, daemonSet *appsv1.DaemonSet) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(daemonSet)
	return resourcemodel.WorkloadResourceModel(clusterID, "apps", "v1", "DaemonSet", "daemonsets", daemonSet.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the DaemonSet facts from the raw object.
func BuildFacts(daemonSet *appsv1.DaemonSet) Facts {
	common := resourcemodel.WorkloadCommonFacts{
		DesiredReplicas:   daemonSet.Status.DesiredNumberScheduled,
		CurrentReplicas:   daemonSet.Status.CurrentNumberScheduled,
		ReadyReplicas:     daemonSet.Status.NumberReady,
		UpdatedReplicas:   daemonSet.Status.UpdatedNumberScheduled,
		AvailableReplicas: daemonSet.Status.NumberAvailable,
		Conditions:        conditionFacts(daemonSet.Status.Conditions),
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

	return Facts{
		WorkloadCommonFacts:  common,
		PodTemplateFacts:     resourcemodel.BuildPodTemplateFacts(daemonSet.Spec.Template),
		UpdateStrategy:       string(daemonSet.Spec.UpdateStrategy.Type),
		MaxUnavailable:       maxUnavailable,
		MaxSurge:             maxSurge,
		MinReadySeconds:      daemonSet.Spec.MinReadySeconds,
		RevisionHistoryLimit: resourcemodel.Int32PtrValue(daemonSet.Spec.RevisionHistoryLimit),
		Selector:             selector,
		ObservedGeneration:   daemonSet.Status.ObservedGeneration,
		NumberMisscheduled:   daemonSet.Status.NumberMisscheduled,
		CollisionCount:       daemonSet.Status.CollisionCount,
		ReadySummary:         readySummary(daemonSet),
	}
}

// readySummary is the short details string for a DaemonSet.
func readySummary(daemonSet *appsv1.DaemonSet) string {
	summary := fmt.Sprintf("Desired: %d, Current: %d, Ready: %d", daemonSet.Status.DesiredNumberScheduled, daemonSet.Status.CurrentNumberScheduled, daemonSet.Status.NumberReady)
	if daemonSet.Status.NumberUnavailable > 0 {
		summary += fmt.Sprintf(", Unavailable: %d", daemonSet.Status.NumberUnavailable)
	}
	if daemonSet.Status.NumberMisscheduled > 0 {
		summary += fmt.Sprintf(", Misscheduled: %d", daemonSet.Status.NumberMisscheduled)
	}
	return summary
}

// BuildStatusPresentation derives the DaemonSet status presentation.
func BuildStatusPresentation(daemonSet *appsv1.DaemonSet) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(daemonSet)
	signals := resourcemodel.WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, statusSignals(daemonSet)...)
	lifecycle := resourcemodel.WorkloadLifecycle(daemonSet.ObjectMeta)
	if status, ok := resourcemodel.DeletingWorkloadStatus(daemonSet.ObjectMeta, resourcemodel.ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	// DaemonSets derive their desired count from eligible nodes; they are not
	// scaled through a replica count like Deployments and StatefulSets.
	if facts.DesiredReplicas == 0 {
		return resourcemodel.WorkloadSourceStatus("No eligible nodes", resourcemodel.ReplicaState(facts.WorkloadCommonFacts), "NoEligibleNodes", "", "warning", signals, lifecycle)
	}
	return resourcemodel.ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func statusSignals(daemonSet *appsv1.DaemonSet) []resourcemodel.ResourceStatusSignal {
	signals := make([]resourcemodel.ResourceStatusSignal, 0, len(daemonSet.Status.Conditions))
	for _, condition := range daemonSet.Status.Conditions {
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

func conditionFacts(conditions []appsv1.DaemonSetCondition) []resourcemodel.ConditionFacts {
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
