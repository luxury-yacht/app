package resourcemodel

import (
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
)

func BuildStorageClassResourceModel(clusterID string, storageClass *storagev1.StorageClass) ResourceModel {
	facts := BuildStorageClassFacts(storageClass)
	status := BuildStorageClassStatusPresentation(storageClass)
	return storageResourceModel(clusterID, "storage.k8s.io", "v1", "StorageClass", "storageclasses", ResourceScopeCluster, storageClass.ObjectMeta, status, ResourceFacts{StorageClass: &facts})
}

func BuildStorageClassFacts(storageClass *storagev1.StorageClass) StorageClassFacts {
	defaultClassAnnotation, defaultClassAnnotationValue := storageClassDefaultAnnotation(storageClass.Annotations)
	facts := StorageClassFacts{
		Provisioner:                 storageClass.Provisioner,
		DefaultClass:                strings.EqualFold(defaultClassAnnotationValue, "true"),
		DefaultClassAnnotation:      defaultClassAnnotation,
		DefaultClassAnnotationValue: defaultClassAnnotationValue,
	}
	if storageClass.ReclaimPolicy != nil {
		facts.ReclaimPolicy = string(*storageClass.ReclaimPolicy)
	} else {
		facts.ReclaimPolicy = string(corev1.PersistentVolumeReclaimDelete)
	}
	if storageClass.VolumeBindingMode != nil {
		facts.VolumeBindingMode = string(*storageClass.VolumeBindingMode)
	} else {
		facts.VolumeBindingMode = string(storagev1.VolumeBindingImmediate)
	}
	if storageClass.AllowVolumeExpansion != nil {
		facts.AllowVolumeExpansion = *storageClass.AllowVolumeExpansion
	}
	return facts
}

func BuildStorageClassStatusPresentation(storageClass *storagev1.StorageClass) ResourceStatusPresentation {
	facts := BuildStorageClassFacts(storageClass)
	state := strconv.FormatBool(facts.DefaultClass)
	signals := []ResourceStatusSignal{
		storageClassDefaultSignal(facts),
		{Type: StatusSignalResourceState, Name: "provisioner", Status: facts.Provisioner},
	}
	lifecycle := storageLifecycle(storageClass.ObjectMeta)
	if status, ok := deletingStorageStatus(storageClass.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if facts.DefaultClass {
		return storageSourceStatus("Default", state, facts.DefaultClassAnnotation, "", "ready", signals, lifecycle)
	}
	return storageSourceStatus("Available", state, "", "", "ready", signals, lifecycle)
}

func storageClassDefaultAnnotation(annotations map[string]string) (string, string) {
	for _, key := range []string{
		"storageclass.kubernetes.io/is-default-class",
		"storageclass.beta.kubernetes.io/is-default-class",
	} {
		if value, ok := annotations[key]; ok {
			return key, value
		}
	}
	return "", ""
}

func storageClassDefaultSignal(facts StorageClassFacts) ResourceStatusSignal {
	signal := ResourceStatusSignal{
		Type:   StatusSignalResourceState,
		Name:   "metadata.annotations",
		Status: strconv.FormatBool(facts.DefaultClass),
	}
	if facts.DefaultClassAnnotation != "" {
		signal.Name = "metadata.annotations." + facts.DefaultClassAnnotation
		signal.Status = facts.DefaultClassAnnotationValue
		signal.Reason = facts.DefaultClassAnnotation
	}
	return signal
}
