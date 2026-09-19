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
	"k8s.io/apimachinery/pkg/api/resource"
)

// BuildResourceModel builds the PVC resource model (status only; facts via BuildFacts).
func BuildResourceModel(clusterID string, pvc *corev1.PersistentVolumeClaim) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(pvc)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, pvc.ObjectMeta, status, resourcemodel.ResourceFacts{})
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
	if storage, ok := storageCapacity(pvc); ok {
		qty := storage.DeepCopy()
		facts.Capacity.Storage = &qty
	}

	return facts
}

// BuildStatusPresentation derives the PVC status presentation.
func BuildStatusPresentation(pvc *corev1.PersistentVolumeClaim) resourcemodel.ResourceStatusPresentation {
	state := pvcState(pvc)
	signals := pvcSignals(pvc)
	lifecycle := resourcemodel.ObjectLifecycle(pvc.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(pvc.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	switch pvc.Status.Phase {
	case corev1.ClaimBound:
		return resourcemodel.ObjectSourceStatus(string(pvc.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.ClaimPending:
		return resourcemodel.ObjectSourceStatus(string(pvc.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.ClaimLost:
		return resourcemodel.ObjectSourceStatus(string(pvc.Status.Phase), state, "", "", "error", signals, lifecycle)
	case "":
		return resourcemodel.ObjectSourceStatus("Unknown", state, "", "", "unknown", signals, lifecycle)
	default:
		return resourcemodel.ObjectSourceStatus(string(pvc.Status.Phase), state, "", "", "inactive", signals, lifecycle)
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
	return pvc.Annotations["volume.beta.kubernetes.io/storage-class"]
}

func pvcSignals(pvc *corev1.PersistentVolumeClaim) []resourcemodel.ResourceStatusSignal {
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalPhase,
		Name:   "status.phase",
		Status: pvcState(pvc),
	}}
	if storageClass := storageClassName(pvc); storageClass != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.storageClassName", Status: storageClass})
	}
	if pvc.Spec.VolumeName != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.volumeName", Status: pvc.Spec.VolumeName})
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

// storageCapacity uses the reported quantity when present, otherwise the request.
func storageCapacity(pvc *corev1.PersistentVolumeClaim) (resource.Quantity, bool) {
	if quantity, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
		return quantity, true
	}
	quantity, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]
	return quantity, ok
}
