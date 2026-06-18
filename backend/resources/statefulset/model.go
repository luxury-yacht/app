/*
 * backend/resources/statefulset/model.go
 *
 * StatefulSet resource model: extracts the canonical facts + status presentation
 * from the raw object. This is the single definition of a StatefulSet's intrinsic
 * fields; detail/summary/object-map projections derive from it.
 *
 * The facts struct type (resourcemodel.StatefulSetFacts) stays in resourcemodel
 * because the shared resourcemodel.ResourceFacts union references it; the build
 * logic lives here with the rest of the kind's code.
 */

package statefulset

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
)

// BuildResourceModel builds the StatefulSet resource model. The StatefulSet facts
// type is owned by this package (statefulset.Facts), so the shared ResourceModel
// carries only the identity + status; callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, statefulSet *appsv1.StatefulSet) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(statefulSet)
	return resourcemodel.WorkloadResourceModel(clusterID, "apps", "v1", "StatefulSet", "statefulsets", statefulSet.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the StatefulSet facts from the raw object.
func BuildFacts(statefulSet *appsv1.StatefulSet) Facts {
	desired := int32(0)
	if statefulSet.Spec.Replicas != nil {
		desired = *statefulSet.Spec.Replicas
	}
	common := resourcemodel.WorkloadCommonFacts{
		DesiredReplicas:   desired,
		CurrentReplicas:   statefulSet.Status.Replicas,
		ReadyReplicas:     statefulSet.Status.ReadyReplicas,
		UpdatedReplicas:   statefulSet.Status.UpdatedReplicas,
		AvailableReplicas: statefulSet.Status.AvailableReplicas,
		Conditions:        conditionFacts(statefulSet.Status.Conditions),
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

	return Facts{
		WorkloadCommonFacts:   common,
		PodTemplateFacts:      resourcemodel.BuildPodTemplateFacts(statefulSet.Spec.Template),
		UpdateStrategy:        string(statefulSet.Spec.UpdateStrategy.Type),
		Partition:             partition,
		MaxUnavailable:        maxUnavailable,
		PodManagementPolicy:   string(statefulSet.Spec.PodManagementPolicy),
		MinReadySeconds:       statefulSet.Spec.MinReadySeconds,
		RevisionHistoryLimit:  resourcemodel.Int32PtrValue(statefulSet.Spec.RevisionHistoryLimit),
		ServiceName:           statefulSet.Spec.ServiceName,
		Selector:              selector,
		StatusCurrentRevision: statefulSet.Status.CurrentRevision,
		StatusUpdateRevision:  statefulSet.Status.UpdateRevision,
		StatusCurrentReplicas: statefulSet.Status.CurrentReplicas,
		ObservedGeneration:    statefulSet.Status.ObservedGeneration,
		CollisionCount:        statefulSet.Status.CollisionCount,
		ReadySummary:          readySummary(statefulSet, common),
	}
}

// readySummary is the short details string for a StatefulSet.
func readySummary(statefulSet *appsv1.StatefulSet, common resourcemodel.WorkloadCommonFacts) string {
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

// BuildStatusPresentation derives the StatefulSet status presentation.
func BuildStatusPresentation(statefulSet *appsv1.StatefulSet) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(statefulSet)
	signals := resourcemodel.WorkloadReplicaSignals(facts.WorkloadCommonFacts)
	signals = append(signals, statusSignals(statefulSet)...)
	lifecycle := resourcemodel.WorkloadLifecycle(statefulSet.ObjectMeta)
	if status, ok := resourcemodel.DeletingWorkloadStatus(statefulSet.ObjectMeta, resourcemodel.ReplicaState(facts.WorkloadCommonFacts), signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ReplicaStatusPresentation(facts.WorkloadCommonFacts, signals, lifecycle)
}

func statusSignals(statefulSet *appsv1.StatefulSet) []resourcemodel.ResourceStatusSignal {
	signals := make([]resourcemodel.ResourceStatusSignal, 0, len(statefulSet.Status.Conditions))
	for _, condition := range statefulSet.Status.Conditions {
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

func conditionFacts(conditions []appsv1.StatefulSetCondition) []resourcemodel.ConditionFacts {
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
