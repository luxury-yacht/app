/*
 * backend/resources/persistentvolume/details.go
 *
 * PersistentVolume resource handlers, co-located in the per-kind package.
 */

package persistentvolume

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed PersistentVolume views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a PersistentVolume service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// PersistentVolume returns the detailed view for a single persistent volume.
func (s *Service) PersistentVolume(ctx context.Context, name string) (*PersistentVolumeDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pv, err := s.deps.KubernetesClient.CoreV1().PersistentVolumes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		err = s.deps.LogResourceRequestFailure(err, fmt.Sprintf("Failed to get persistent volume %s", name), "get", Identity, logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get persistent volume: %w", err)
	}

	return s.processPersistentVolumeDetails(pv), nil
}

func (s *Service) processPersistentVolumeDetails(pv *corev1.PersistentVolume) *PersistentVolumeDetails {
	model := BuildResourceModel(s.deps.ClusterID, pv)
	details := newPersistentVolumeDetails(pv, restypes.NewStatusProjection(model.Status))
	details.Capacity = persistentVolumeCapacity(pv.Spec.Capacity)
	details.AccessModes = persistentVolumeAccessModes(pv.Spec.AccessModes)
	details.VolumeMode = persistentVolumeMode(pv.Spec.VolumeMode)
	details.ClaimRef = persistentVolumeClaimReference(pv.Spec.ClaimRef)
	details.VolumeSource = persistentVolumeSourceInfo(pv.Spec.PersistentVolumeSource)
	details.NodeAffinity = persistentVolumeNodeAffinity(pv.Spec.NodeAffinity)
	details.Conditions = persistentVolumeConditions(pv.Status)
	details.Details = persistentVolumeSummary(details)
	return details
}

func newPersistentVolumeDetails(pv *corev1.PersistentVolume, status restypes.StatusProjection) *PersistentVolumeDetails {
	return &PersistentVolumeDetails{
		Kind:             "PersistentVolume",
		Name:             pv.Name,
		StatusProjection: status,
		StorageClass:     pv.Spec.StorageClassName,
		ReclaimPolicy:    string(pv.Spec.PersistentVolumeReclaimPolicy),
		MountOptions:     pv.Spec.MountOptions,
		Labels:           pv.Labels,
		Annotations:      pv.Annotations,
	}
}

func persistentVolumeCapacity(capacity corev1.ResourceList) string {
	if storage, ok := capacity[corev1.ResourceStorage]; ok {
		return storage.String()
	}
	return ""
}

func persistentVolumeAccessModes(accessModes []corev1.PersistentVolumeAccessMode) []string {
	var result []string
	for _, mode := range accessModes {
		result = append(result, string(mode))
	}
	return result
}

func persistentVolumeMode(mode *corev1.PersistentVolumeMode) string {
	if mode != nil {
		return string(*mode)
	}
	return "Filesystem"
}

func persistentVolumeClaimReference(reference *corev1.ObjectReference) *ClaimReference {
	if reference == nil {
		return nil
	}
	return &ClaimReference{Namespace: reference.Namespace, Name: reference.Name}
}

func persistentVolumeSourceInfo(source corev1.PersistentVolumeSource) VolumeSourceInfo {
	switch {
	case source.HostPath != nil:
		return hostPathVolumeSourceInfo(source.HostPath)
	case source.NFS != nil:
		return nfsVolumeSourceInfo(source.NFS)
	case source.CSI != nil:
		return csiVolumeSourceInfo(source.CSI)
	case source.AWSElasticBlockStore != nil:
		return awsVolumeSourceInfo(source.AWSElasticBlockStore)
	case source.GCEPersistentDisk != nil:
		return gceVolumeSourceInfo(source.GCEPersistentDisk)
	case source.AzureDisk != nil:
		return azureDiskVolumeSourceInfo(source.AzureDisk)
	case source.AzureFile != nil:
		return azureFileVolumeSourceInfo(source.AzureFile)
	case source.FC != nil:
		return fibreChannelVolumeSourceInfo(source.FC)
	case source.ISCSI != nil:
		return iscsiVolumeSourceInfo(source.ISCSI)
	case source.Local != nil:
		return localVolumeSourceInfo(source.Local)
	default:
		return VolumeSourceInfo{Type: "Unknown", Details: map[string]string{}}
	}
}

func hostPathVolumeSourceInfo(source *corev1.HostPathVolumeSource) VolumeSourceInfo {
	details := map[string]string{"path": source.Path}
	if source.Type != nil {
		details["type"] = string(*source.Type)
	}
	return VolumeSourceInfo{Type: "HostPath", Details: details}
}

func nfsVolumeSourceInfo(source *corev1.NFSVolumeSource) VolumeSourceInfo {
	return VolumeSourceInfo{Type: "NFS", Details: map[string]string{
		"server": source.Server, "path": source.Path, "readOnly": fmt.Sprintf("%v", source.ReadOnly),
	}}
}

func csiVolumeSourceInfo(source *corev1.CSIPersistentVolumeSource) VolumeSourceInfo {
	details := map[string]string{
		"driver": source.Driver, "volumeHandle": source.VolumeHandle, "readOnly": fmt.Sprintf("%v", source.ReadOnly),
	}
	if source.FSType != "" {
		details["fsType"] = source.FSType
	}
	return VolumeSourceInfo{Type: "CSI", Details: details}
}

func awsVolumeSourceInfo(source *corev1.AWSElasticBlockStoreVolumeSource) VolumeSourceInfo {
	return VolumeSourceInfo{Type: "AWSElasticBlockStore", Details: map[string]string{
		"volumeID": source.VolumeID, "fsType": source.FSType, "partition": fmt.Sprintf("%d", source.Partition), "readOnly": fmt.Sprintf("%v", source.ReadOnly),
	}}
}

func gceVolumeSourceInfo(source *corev1.GCEPersistentDiskVolumeSource) VolumeSourceInfo {
	return VolumeSourceInfo{Type: "GCEPersistentDisk", Details: map[string]string{
		"pdName": source.PDName, "fsType": source.FSType, "partition": fmt.Sprintf("%d", source.Partition), "readOnly": fmt.Sprintf("%v", source.ReadOnly),
	}}
}

func azureDiskVolumeSourceInfo(source *corev1.AzureDiskVolumeSource) VolumeSourceInfo {
	details := map[string]string{"diskName": source.DiskName, "diskURI": source.DataDiskURI}
	if source.FSType != nil {
		details["fsType"] = *source.FSType
	}
	if source.ReadOnly != nil {
		details["readOnly"] = fmt.Sprintf("%v", *source.ReadOnly)
	}
	return VolumeSourceInfo{Type: "AzureDisk", Details: details}
}

func azureFileVolumeSourceInfo(source *corev1.AzureFilePersistentVolumeSource) VolumeSourceInfo {
	return VolumeSourceInfo{Type: "AzureFile", Details: map[string]string{
		"secretName": source.SecretName, "shareName": source.ShareName, "readOnly": fmt.Sprintf("%v", source.ReadOnly),
	}}
}

func fibreChannelVolumeSourceInfo(source *corev1.FCVolumeSource) VolumeSourceInfo {
	return VolumeSourceInfo{Type: "FibreChannel", Details: map[string]string{
		"readOnly": fmt.Sprintf("%v", source.ReadOnly), "fsType": source.FSType,
	}}
}

func iscsiVolumeSourceInfo(source *corev1.ISCSIPersistentVolumeSource) VolumeSourceInfo {
	return VolumeSourceInfo{Type: "iSCSI", Details: map[string]string{
		"targetPortal": source.TargetPortal,
		"iqn":          source.IQN,
		"lun":          fmt.Sprintf("%d", source.Lun),
		"fsType":       source.FSType,
		"readOnly":     fmt.Sprintf("%v", source.ReadOnly),
	}}
}

func localVolumeSourceInfo(source *corev1.LocalVolumeSource) VolumeSourceInfo {
	details := map[string]string{"path": source.Path}
	if source.FSType != nil {
		details["fsType"] = *source.FSType
	}
	return VolumeSourceInfo{Type: "Local", Details: details}
}

func persistentVolumeNodeAffinity(affinity *corev1.VolumeNodeAffinity) []string {
	if affinity == nil || affinity.Required == nil {
		return nil
	}
	var result []string
	for _, term := range affinity.Required.NodeSelectorTerms {
		for _, expr := range term.MatchExpressions {
			result = append(result, fmt.Sprintf("%s %s %v", expr.Key, expr.Operator, expr.Values))
		}
	}
	return result
}

func persistentVolumeConditions(status corev1.PersistentVolumeStatus) []string {
	var conditions []string
	if status.Reason != "" {
		conditions = append(conditions, status.Reason)
	}
	if status.Message != "" {
		conditions = append(conditions, status.Message)
	}
	return conditions
}

func persistentVolumeAccessModesSummary(accessModes []string) string {
	short := make([]string, 0, len(accessModes))
	for _, mode := range accessModes {
		short = append(short, persistentVolumeAccessModeSummary(mode))
	}
	return strings.Join(short, ",")
}

func persistentVolumeAccessModeSummary(mode string) string {
	switch mode {
	case "ReadWriteOnce":
		return "RWO"
	case "ReadOnlyMany":
		return "ROX"
	case "ReadWriteMany":
		return "RWX"
	default:
		return mode
	}
}

func persistentVolumeClaimSummary(claim *ClaimReference) string {
	claimInfo := "Available"
	if claim != nil {
		claimInfo = fmt.Sprintf("%s/%s", claim.Namespace, claim.Name)
	}
	return claimInfo
}

func persistentVolumeSummary(details *PersistentVolumeDetails) string {
	return fmt.Sprintf("%s, %s, %s, Claim: %s",
		details.Status,
		details.Capacity,
		persistentVolumeAccessModesSummary(details.AccessModes),
		persistentVolumeClaimSummary(details.ClaimRef),
	)
}
