package resourcemodel

import (
	corev1 "k8s.io/api/core/v1"
)

func BuildPersistentVolumeResourceModel(clusterID string, pv *corev1.PersistentVolume) ResourceModel {
	facts := BuildPersistentVolumeFacts(pv)
	status := BuildPersistentVolumeStatusPresentation(pv)
	return storageResourceModel(clusterID, "", "v1", "PersistentVolume", "persistentvolumes", ResourceScopeCluster, pv.ObjectMeta, status, ResourceFacts{PersistentVolume: &facts})
}

func BuildPersistentVolumeFacts(pv *corev1.PersistentVolume) PersistentVolumeFacts {
	facts := PersistentVolumeFacts{
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

func BuildPersistentVolumeStatusPresentation(pv *corev1.PersistentVolume) ResourceStatusPresentation {
	facts := BuildPersistentVolumeFacts(pv)
	state := persistentVolumeState(pv)
	signals := persistentVolumeSignals(pv, facts)
	lifecycle := storageLifecycle(pv.ObjectMeta)
	if status, ok := deletingStorageStatus(pv.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	switch pv.Status.Phase {
	case corev1.VolumeBound:
		return storageSourceStatus(string(pv.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.VolumeAvailable:
		return storageSourceStatus(string(pv.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.VolumePending:
		return storageSourceStatus(string(pv.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.VolumeReleased:
		return storageSourceStatus(string(pv.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.VolumeFailed:
		return storageSourceStatus(string(pv.Status.Phase), state, pv.Status.Reason, pv.Status.Message, "error", signals, lifecycle)
	default:
		if pv.Status.Phase == "" {
			return storageSourceStatus("Unknown", state, "", "", "unknown", signals, lifecycle)
		}
		return storageSourceStatus(string(pv.Status.Phase), state, pv.Status.Reason, pv.Status.Message, "inactive", signals, lifecycle)
	}
}

func persistentVolumeState(pv *corev1.PersistentVolume) string {
	if pv.Status.Phase == "" {
		return "Unknown"
	}
	return string(pv.Status.Phase)
}

func persistentVolumeSignals(pv *corev1.PersistentVolume, facts PersistentVolumeFacts) []ResourceStatusSignal {
	signals := []ResourceStatusSignal{{
		Type:    StatusSignalPhase,
		Name:    "status.phase",
		Status:  persistentVolumeState(pv),
		Reason:  pv.Status.Reason,
		Message: pv.Status.Message,
	}}
	if facts.StorageClass != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalResourceState, Name: "spec.storageClassName", Status: facts.StorageClass})
	}
	if facts.ReclaimPolicy != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalResourceState, Name: "spec.persistentVolumeReclaimPolicy", Status: facts.ReclaimPolicy})
	}
	if facts.ClaimName != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalResourceState, Name: "spec.claimRef", Status: facts.ClaimNamespace + "/" + facts.ClaimName})
	}
	return signals
}
