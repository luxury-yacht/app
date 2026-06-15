/*
 * backend/resources/persistentvolumeclaim/model.go
 *
 * PersistentVolumeClaim resource model: the single definition of a PVC's intrinsic
 * fields + status presentation. Shared storage base from resourcemodel.
 */

package persistentvolumeclaim

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the PVC resource model (status only; facts via BuildFacts).
func BuildResourceModel(clusterID string, pvc *corev1.PersistentVolumeClaim) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(pvc)
	return resourcemodel.StorageResourceModel(clusterID, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", resourcemodel.ResourceScopeNamespaced, pvc.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the PVC facts from the raw object, materializing reverse
// links (MountedBy) when relationships + the option are supplied.
func BuildFacts(pvc *corev1.PersistentVolumeClaim, relationships *resourcemodel.ResourceRelationshipIndex, options ...resourcemodel.ResourceModelBuildOptions) Facts {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := Facts{
		Phase:        string(pvc.Status.Phase),
		StorageClass: storageClassName(pvc),
		VolumeName:   pvc.Spec.VolumeName,
		Conditions:   conditionFacts(pvc.Status.Conditions),
	}
	if buildOptions.Materialization.Has(resourcemodel.MaterializeReverseLinks) && relationships != nil {
		facts.MountedBy = relationships.PersistentVolumeClaimMountedBy(pvc.Namespace, pvc.Name)
	}
	if storage, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
		qty := storage.DeepCopy()
		facts.Capacity.Storage = &qty
	} else if storage, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
		qty := storage.DeepCopy()
		facts.Capacity.Storage = &qty
	}
	return facts
}

// BuildStatusPresentation derives the PVC status presentation.
func BuildStatusPresentation(pvc *corev1.PersistentVolumeClaim) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(pvc, nil, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts})
	state := pvcState(pvc)
	signals := pvcSignals(pvc, facts)
	lifecycle := resourcemodel.StorageLifecycle(pvc.ObjectMeta)
	if status, ok := resourcemodel.DeletingStorageStatus(pvc.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	switch pvc.Status.Phase {
	case corev1.ClaimBound:
		return resourcemodel.StorageSourceStatus(string(pvc.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.ClaimPending:
		return resourcemodel.StorageSourceStatus(string(pvc.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.ClaimLost:
		return resourcemodel.StorageSourceStatus(string(pvc.Status.Phase), state, "", "", "error", signals, lifecycle)
	default:
		if pvc.Status.Phase == "" {
			return resourcemodel.StorageSourceStatus("Unknown", state, "", "", "unknown", signals, lifecycle)
		}
		return resourcemodel.StorageSourceStatus(string(pvc.Status.Phase), state, "", "", "inactive", signals, lifecycle)
	}
}

func pvcState(pvc *corev1.PersistentVolumeClaim) string {
	if pvc.Status.Phase == "" {
		return "Unknown"
	}
	return string(pvc.Status.Phase)
}

func storageClassName(pvc *corev1.PersistentVolumeClaim) string {
	if pvc.Spec.StorageClassName != nil {
		return *pvc.Spec.StorageClassName
	}
	if pvc.Annotations != nil {
		if value, ok := pvc.Annotations["volume.beta.kubernetes.io/storage-class"]; ok {
			return value
		}
	}
	return ""
}

func pvcSignals(pvc *corev1.PersistentVolumeClaim, facts Facts) []resourcemodel.ResourceStatusSignal {
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalPhase,
		Name:   "status.phase",
		Status: pvcState(pvc),
	}}
	if facts.StorageClass != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.storageClassName", Status: facts.StorageClass})
	}
	if facts.VolumeName != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.volumeName", Status: facts.VolumeName})
	}
	for _, condition := range pvc.Status.Conditions {
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

func conditionFacts(conditions []corev1.PersistentVolumeClaimCondition) []resourcemodel.ConditionFacts {
	facts := make([]resourcemodel.ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, resourcemodel.ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}
