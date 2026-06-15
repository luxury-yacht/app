/*
 * backend/resources/storageclass/model.go
 *
 * StorageClass resource model: the single definition of a StorageClass's
 * intrinsic fields + status presentation. Detail/object-map/streaming projections
 * derive from it. Shared model helpers are reused from resourcemodel (exported base).
 */

package storageclass

import (
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
)

// BuildResourceModel builds the StorageClass resource model. Facts are owned by
// this package (storageclass.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, storageClass *storagev1.StorageClass) resourcemodel.ResourceModel {
	facts := BuildFacts(storageClass)
	status := statusPresentation(storageClass, facts)
	return resourcemodel.StorageResourceModel(clusterID, "storage.k8s.io", "v1", "StorageClass", "storageclasses", resourcemodel.ResourceScopeCluster, storageClass.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the StorageClass facts from the raw object.
func BuildFacts(storageClass *storagev1.StorageClass) Facts {
	defaultClassAnnotation, defaultClassAnnotationValue := storageClassDefaultAnnotation(storageClass.Annotations)
	facts := Facts{
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

func statusPresentation(storageClass *storagev1.StorageClass, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strconv.FormatBool(facts.DefaultClass)
	signals := []resourcemodel.ResourceStatusSignal{
		storageClassDefaultSignal(facts),
		{Type: resourcemodel.StatusSignalResourceState, Name: "provisioner", Status: facts.Provisioner},
	}
	lifecycle := resourcemodel.StorageLifecycle(storageClass.ObjectMeta)
	if status, ok := resourcemodel.DeletingStorageStatus(storageClass.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if facts.DefaultClass {
		return resourcemodel.StorageSourceStatus("Default", state, facts.DefaultClassAnnotation, "", "ready", signals, lifecycle)
	}
	return resourcemodel.StorageSourceStatus("Available", state, "", "", "ready", signals, lifecycle)
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

func storageClassDefaultSignal(facts Facts) resourcemodel.ResourceStatusSignal {
	signal := resourcemodel.ResourceStatusSignal{
		Type:   resourcemodel.StatusSignalResourceState,
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
