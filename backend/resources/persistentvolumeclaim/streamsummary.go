/*
 * backend/resources/persistentvolumeclaim/streamsummary.go
 *
 * PersistentVolumeClaim's stream-summary builder, owned by the kind's package.
 * Produces the neutral streamrows.StorageSummary row. Returns a leaf type, so no
 * snapshot import.
 */

package persistentvolumeclaim

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the namespace-storage row for one PVC.
func BuildStreamSummary(meta streamrows.ClusterMeta, pvc *corev1.PersistentVolumeClaim) streamrows.StorageSummary {
	if pvc == nil {
		return streamrows.StorageSummary{}
	}
	model := BuildResourceModel(meta.ClusterID, pvc)
	return streamrows.StorageSummary{
		Ref:                model.Ref,
		Metadata:           streamrows.NewResourceMetadata(pvc),
		Capacity:           streamCapacity(pvc),
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		StorageClass:       storageClassName(pvc),
		Age:                streamrows.FormatAge(pvc.CreationTimestamp.Time),
		AgeTimestamp:       streamrows.CreationMillis(pvc),
	}
}

// streamCapacity is the PVC's storage capacity (status, else requested, else "-").
func streamCapacity(pvc *corev1.PersistentVolumeClaim) string {
	if quantity, ok := storageCapacity(pvc); ok {
		return quantity.String()
	}
	return "-"
}
