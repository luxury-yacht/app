package storage

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) PersistentVolume(name string) (*restypes.PersistentVolumeDetails, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pv, err := s.deps.Common.KubernetesClient.CoreV1().PersistentVolumes().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get persistent volume %s: %v", name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get persistent volume: %v", err)
	}

	return s.processPersistentVolumeDetails(pv), nil
}

func (s *Service) PersistentVolumes() ([]*restypes.PersistentVolumeDetails, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvs, err := s.deps.Common.KubernetesClient.CoreV1().PersistentVolumes().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list persistent volumes: %v", err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list persistent volumes: %v", err)
	}

	var detailsList []*restypes.PersistentVolumeDetails
	for i := range pvs.Items {
		detailsList = append(detailsList, s.processPersistentVolumeDetails(&pvs.Items[i]))
	}

	return detailsList, nil
}

func (s *Service) processPersistentVolumeDetails(pv *corev1.PersistentVolume) *restypes.PersistentVolumeDetails {
	details := &restypes.PersistentVolumeDetails{
		Kind:          "PersistentVolume",
		Name:          pv.Name,
		Age:           common.FormatAge(pv.CreationTimestamp.Time),
		Status:        string(pv.Status.Phase),
		StorageClass:  pv.Spec.StorageClassName,
		ReclaimPolicy: string(pv.Spec.PersistentVolumeReclaimPolicy),
		MountOptions:  pv.Spec.MountOptions,
		Labels:        pv.Labels,
		Annotations:   pv.Annotations,
	}

	if storage, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
		details.Capacity = storage.String()
	}

	for _, mode := range pv.Spec.AccessModes {
		details.AccessModes = append(details.AccessModes, string(mode))
	}

	if pv.Spec.VolumeMode != nil {
		details.VolumeMode = string(*pv.Spec.VolumeMode)
	} else {
		details.VolumeMode = "Filesystem"
	}

	if pv.Spec.ClaimRef != nil {
		details.ClaimRef = &restypes.ClaimReference{
			Namespace: pv.Spec.ClaimRef.Namespace,
			Name:      pv.Spec.ClaimRef.Name,
		}
	}

	volumeSource := restypes.VolumeSourceInfo{Details: make(map[string]string)}

	switch {
	case pv.Spec.HostPath != nil:
		volumeSource.Type = "HostPath"
		volumeSource.Details["path"] = pv.Spec.HostPath.Path
		if pv.Spec.HostPath.Type != nil {
			volumeSource.Details["type"] = string(*pv.Spec.HostPath.Type)
		}
	case pv.Spec.NFS != nil:
		volumeSource.Type = "NFS"
		volumeSource.Details["server"] = pv.Spec.NFS.Server
		volumeSource.Details["path"] = pv.Spec.NFS.Path
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.NFS.ReadOnly)
	case pv.Spec.CSI != nil:
		volumeSource.Type = "CSI"
		volumeSource.Details["driver"] = pv.Spec.CSI.Driver
		volumeSource.Details["volumeHandle"] = pv.Spec.CSI.VolumeHandle
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.CSI.ReadOnly)
		if pv.Spec.CSI.FSType != "" {
			volumeSource.Details["fsType"] = pv.Spec.CSI.FSType
		}
	case pv.Spec.AWSElasticBlockStore != nil:
		volumeSource.Type = "AWSElasticBlockStore"
		volumeSource.Details["volumeID"] = pv.Spec.AWSElasticBlockStore.VolumeID
		volumeSource.Details["fsType"] = pv.Spec.AWSElasticBlockStore.FSType
		volumeSource.Details["partition"] = fmt.Sprintf("%d", pv.Spec.AWSElasticBlockStore.Partition)
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.AWSElasticBlockStore.ReadOnly)
	case pv.Spec.GCEPersistentDisk != nil:
		volumeSource.Type = "GCEPersistentDisk"
		volumeSource.Details["pdName"] = pv.Spec.GCEPersistentDisk.PDName
		volumeSource.Details["fsType"] = pv.Spec.GCEPersistentDisk.FSType
		volumeSource.Details["partition"] = fmt.Sprintf("%d", pv.Spec.GCEPersistentDisk.Partition)
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.GCEPersistentDisk.ReadOnly)
	case pv.Spec.AzureDisk != nil:
		volumeSource.Type = "AzureDisk"
		volumeSource.Details["diskName"] = pv.Spec.AzureDisk.DiskName
		volumeSource.Details["diskURI"] = pv.Spec.AzureDisk.DataDiskURI
		if pv.Spec.AzureDisk.FSType != nil {
			volumeSource.Details["fsType"] = *pv.Spec.AzureDisk.FSType
		}
		if pv.Spec.AzureDisk.ReadOnly != nil {
			volumeSource.Details["readOnly"] = fmt.Sprintf("%v", *pv.Spec.AzureDisk.ReadOnly)
		}
	case pv.Spec.AzureFile != nil:
		volumeSource.Type = "AzureFile"
		volumeSource.Details["secretName"] = pv.Spec.AzureFile.SecretName
		volumeSource.Details["shareName"] = pv.Spec.AzureFile.ShareName
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.AzureFile.ReadOnly)
	case pv.Spec.FC != nil:
		volumeSource.Type = "FibreChannel"
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.FC.ReadOnly)
		volumeSource.Details["fsType"] = pv.Spec.FC.FSType
	case pv.Spec.ISCSI != nil:
		volumeSource.Type = "iSCSI"
		volumeSource.Details["targetPortal"] = pv.Spec.ISCSI.TargetPortal
		volumeSource.Details["iqn"] = pv.Spec.ISCSI.IQN
		volumeSource.Details["lun"] = fmt.Sprintf("%d", pv.Spec.ISCSI.Lun)
		volumeSource.Details["fsType"] = pv.Spec.ISCSI.FSType
		volumeSource.Details["readOnly"] = fmt.Sprintf("%v", pv.Spec.ISCSI.ReadOnly)
	case pv.Spec.Local != nil:
		volumeSource.Type = "Local"
		volumeSource.Details["path"] = pv.Spec.Local.Path
		if pv.Spec.Local.FSType != nil {
			volumeSource.Details["fsType"] = *pv.Spec.Local.FSType
		}
	default:
		volumeSource.Type = "Unknown"
	}

	details.VolumeSource = volumeSource

	if pv.Spec.NodeAffinity != nil && pv.Spec.NodeAffinity.Required != nil {
		for _, term := range pv.Spec.NodeAffinity.Required.NodeSelectorTerms {
			for _, expr := range term.MatchExpressions {
				details.NodeAffinity = append(details.NodeAffinity, fmt.Sprintf("%s %s %v", expr.Key, expr.Operator, expr.Values))
			}
		}
	}

	if pv.Status.Reason != "" {
		details.Conditions = append(details.Conditions, pv.Status.Reason)
	}
	if pv.Status.Message != "" {
		details.Conditions = append(details.Conditions, pv.Status.Message)
	}

	accessModesShort := ""
	for i, mode := range pv.Spec.AccessModes {
		if i > 0 {
			accessModesShort += ","
		}
		switch mode {
		case "ReadWriteOnce":
			accessModesShort += "RWO"
		case "ReadOnlyMany":
			accessModesShort += "ROX"
		case "ReadWriteMany":
			accessModesShort += "RWX"
		default:
			accessModesShort += string(mode)
		}
	}

	claimInfo := "Available"
	if details.ClaimRef != nil {
		claimInfo = fmt.Sprintf("%s/%s", details.ClaimRef.Namespace, details.ClaimRef.Name)
	}

	details.Details = fmt.Sprintf("%s, %s, %s, Claim: %s", details.Status, details.Capacity, accessModesShort, claimInfo)

	return details
}

func (s *Service) listPersistentVolumes() *corev1.PersistentVolumeList {
	if s.deps.Common.KubernetesClient == nil {
		return nil
	}

	pvs, err := s.deps.Common.KubernetesClient.CoreV1().PersistentVolumes().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list persistent volumes: %v", err), "ResourceLoader")
		return nil
	}
	return pvs
}
