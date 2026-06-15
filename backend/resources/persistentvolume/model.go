/*
 * backend/resources/persistentvolume/model.go
 *
 * PersistentVolume resource model: the single definition of a PV's intrinsic
 * fields + status presentation. Shared storage base from resourcemodel.
 */

package persistentvolume

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the PersistentVolume resource model. Facts are owned
// by this package; the shared ResourceModel carries identity + status.
func BuildResourceModel(clusterID string, pv *corev1.PersistentVolume) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(pv)
	return resourcemodel.StorageResourceModel(clusterID, "", "v1", "PersistentVolume", "persistentvolumes", resourcemodel.ResourceScopeCluster, pv.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the PersistentVolume facts from the raw object.
func BuildFacts(pv *corev1.PersistentVolume) Facts {
	facts := Facts{
		Phase:         string(pv.Status.Phase),
		StorageClass:  pv.Spec.StorageClassName,
		ReclaimPolicy: string(pv.Spec.PersistentVolumeReclaimPolicy),
		Reason:        pv.Status.Reason,
		Message:       pv.Status.Message,
	}
	if storage, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
		qty := storage.DeepCopy()
		facts.Capacity.Storage = &qty
	}
	if pv.Spec.ClaimRef != nil {
		facts.ClaimNamespace = pv.Spec.ClaimRef.Namespace
		facts.ClaimName = pv.Spec.ClaimRef.Name
	}
	return facts
}

// BuildStatusPresentation derives the PersistentVolume status presentation.
func BuildStatusPresentation(pv *corev1.PersistentVolume) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(pv)
	state := persistentVolumeState(pv)
	signals := persistentVolumeSignals(pv, facts)
	lifecycle := resourcemodel.StorageLifecycle(pv.ObjectMeta)
	if status, ok := resourcemodel.DeletingStorageStatus(pv.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	switch pv.Status.Phase {
	case corev1.VolumeBound:
		return resourcemodel.StorageSourceStatus(string(pv.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.VolumeAvailable:
		return resourcemodel.StorageSourceStatus(string(pv.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.VolumePending:
		return resourcemodel.StorageSourceStatus(string(pv.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.VolumeReleased:
		return resourcemodel.StorageSourceStatus(string(pv.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.VolumeFailed:
		return resourcemodel.StorageSourceStatus(string(pv.Status.Phase), state, pv.Status.Reason, pv.Status.Message, "error", signals, lifecycle)
	default:
		if pv.Status.Phase == "" {
			return resourcemodel.StorageSourceStatus("Unknown", state, "", "", "unknown", signals, lifecycle)
		}
		return resourcemodel.StorageSourceStatus(string(pv.Status.Phase), state, pv.Status.Reason, pv.Status.Message, "inactive", signals, lifecycle)
	}
}

func persistentVolumeState(pv *corev1.PersistentVolume) string {
	if pv.Status.Phase == "" {
		return "Unknown"
	}
	return string(pv.Status.Phase)
}

func persistentVolumeSignals(pv *corev1.PersistentVolume, facts Facts) []resourcemodel.ResourceStatusSignal {
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:    resourcemodel.StatusSignalPhase,
		Name:    "status.phase",
		Status:  persistentVolumeState(pv),
		Reason:  pv.Status.Reason,
		Message: pv.Status.Message,
	}}
	if facts.StorageClass != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.storageClassName", Status: facts.StorageClass})
	}
	if facts.ReclaimPolicy != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.persistentVolumeReclaimPolicy", Status: facts.ReclaimPolicy})
	}
	if facts.ClaimName != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "spec.claimRef", Status: facts.ClaimNamespace + "/" + facts.ClaimName})
	}
	return signals
}
