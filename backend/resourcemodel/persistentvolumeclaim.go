package resourcemodel

import corev1 "k8s.io/api/core/v1"

func BuildPersistentVolumeClaimResourceModel(clusterID string, pvc *corev1.PersistentVolumeClaim) ResourceModel {
	facts := BuildPersistentVolumeClaimFacts(pvc)
	status := BuildPersistentVolumeClaimStatusPresentation(pvc)
	return storageResourceModel(clusterID, "", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", ResourceScopeNamespaced, pvc.ObjectMeta, status, ResourceFacts{PersistentVolumeClaim: &facts})
}

func BuildPersistentVolumeClaimFacts(pvc *corev1.PersistentVolumeClaim) PersistentVolumeClaimFacts {
	facts := PersistentVolumeClaimFacts{
		Phase:        string(pvc.Status.Phase),
		StorageClass: persistentVolumeClaimStorageClassName(pvc),
		VolumeName:   pvc.Spec.VolumeName,
		Conditions:   persistentVolumeClaimConditionFacts(pvc.Status.Conditions),
	}
	if storage, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
		facts.Capacity = storage.String()
	} else if storage, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
		facts.Capacity = storage.String()
	}
	return facts
}

func BuildPersistentVolumeClaimStatusPresentation(pvc *corev1.PersistentVolumeClaim) ResourceStatusPresentation {
	facts := BuildPersistentVolumeClaimFacts(pvc)
	state := persistentVolumeClaimState(pvc)
	signals := persistentVolumeClaimSignals(pvc, facts)
	lifecycle := storageLifecycle(pvc.ObjectMeta)
	if status, ok := deletingStorageStatus(pvc.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	switch pvc.Status.Phase {
	case corev1.ClaimBound:
		return storageSourceStatus(string(pvc.Status.Phase), state, "", "", "ready", signals, lifecycle)
	case corev1.ClaimPending:
		return storageSourceStatus(string(pvc.Status.Phase), state, "", "", "warning", signals, lifecycle)
	case corev1.ClaimLost:
		return storageSourceStatus(string(pvc.Status.Phase), state, "", "", "error", signals, lifecycle)
	default:
		if pvc.Status.Phase == "" {
			return storageSourceStatus("Unknown", state, "", "", "unknown", signals, lifecycle)
		}
		return storageSourceStatus(string(pvc.Status.Phase), state, "", "", "inactive", signals, lifecycle)
	}
}

func persistentVolumeClaimState(pvc *corev1.PersistentVolumeClaim) string {
	if pvc.Status.Phase == "" {
		return "Unknown"
	}
	return string(pvc.Status.Phase)
}

func persistentVolumeClaimStorageClassName(pvc *corev1.PersistentVolumeClaim) string {
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

func persistentVolumeClaimSignals(pvc *corev1.PersistentVolumeClaim, facts PersistentVolumeClaimFacts) []ResourceStatusSignal {
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalPhase,
		Name:   "status.phase",
		Status: persistentVolumeClaimState(pvc),
	}}
	if facts.StorageClass != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalResourceState, Name: "spec.storageClassName", Status: facts.StorageClass})
	}
	if facts.VolumeName != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalResourceState, Name: "spec.volumeName", Status: facts.VolumeName})
	}
	for _, condition := range pvc.Status.Conditions {
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

func persistentVolumeClaimConditionFacts(conditions []corev1.PersistentVolumeClaimCondition) []ConditionFacts {
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}
