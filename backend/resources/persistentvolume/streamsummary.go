/*
 * backend/resources/persistentvolume/streamsummary.go
 *
 * PersistentVolume's stream-summary builder, owned by the kind's package. Produces
 * the neutral streamrows.ClusterStorageEntry row (cluster-storage). No snapshot import.
 */

package persistentvolume

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the cluster-storage row for one PersistentVolume.
func BuildStreamSummary(meta streamrows.ClusterMeta, pv *corev1.PersistentVolume) streamrows.ClusterStorageEntry {
	if pv == nil {
		return streamrows.ClusterStorageEntry{ClusterMeta: meta, Kind: "PersistentVolume"}
	}
	model := BuildResourceModel(meta.ClusterID, pv)
	return streamrows.ClusterStorageEntry{
		ClusterMeta:        meta,
		Kind:               "PersistentVolume",
		Name:               pv.Name,
		StorageClass:       pv.Spec.StorageClassName,
		Capacity:           streamCapacity(pv),
		AccessModes:        streamAccessModes(pv.Spec.AccessModes),
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Claim:              streamClaimRef(pv.Spec.ClaimRef),
		Age:                streamrows.FormatAge(pv.CreationTimestamp.Time),
		AgeTimestamp:       streamrows.CreationMillis(pv),
	}
}

func streamCapacity(pv *corev1.PersistentVolume) string {
	if pv == nil {
		return "-"
	}
	if qty, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
		return qty.String()
	}
	return "-"
}

func streamAccessModes(modes []corev1.PersistentVolumeAccessMode) string {
	if len(modes) == 0 {
		return "-"
	}
	values := make([]string, 0, len(modes))
	for _, mode := range modes {
		values = append(values, string(mode))
	}
	return strings.Join(values, ",")
}

func streamClaimRef(ref *corev1.ObjectReference) string {
	if ref == nil {
		return "-"
	}
	if ref.Namespace != "" {
		return fmt.Sprintf("%s/%s", ref.Namespace, ref.Name)
	}
	return ref.Name
}
