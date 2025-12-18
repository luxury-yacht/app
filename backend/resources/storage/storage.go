package storage

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Dependencies struct {
	Common common.Dependencies
}

type Service struct {
	deps Dependencies
}

func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

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

func (s *Service) PersistentVolumeClaim(namespace, name string) (*restypes.PersistentVolumeClaimDetails, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvc, err := s.deps.Common.KubernetesClient.CoreV1().PersistentVolumeClaims(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get PVC %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get PVC: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	return s.processPersistentVolumeClaimDetails(pvc, pods), nil
}

func (s *Service) PersistentVolumeClaims(namespace string) ([]*restypes.PersistentVolumeClaimDetails, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvcs, err := s.deps.Common.KubernetesClient.CoreV1().PersistentVolumeClaims(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list PVCs in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list PVCs: %v", err)
	}

	pods := s.listNamespacePods(namespace)

	var detailsList []*restypes.PersistentVolumeClaimDetails
	for i := range pvcs.Items {
		detailsList = append(detailsList, s.processPersistentVolumeClaimDetails(&pvcs.Items[i], pods))
	}

	return detailsList, nil
}

func (s *Service) StorageClass(name string) (*restypes.StorageClassDetails, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	sc, err := s.deps.Common.KubernetesClient.StorageV1().StorageClasses().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get storage class %s: %v", name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get storage class: %v", err)
	}

	pvs := s.listPersistentVolumes()
	return s.processStorageClassDetails(sc, pvs), nil
}

func (s *Service) StorageClasses() ([]*restypes.StorageClassDetails, error) {
	if s.deps.Common.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	storageClasses, err := s.deps.Common.KubernetesClient.StorageV1().StorageClasses().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list storage classes: %v", err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list storage classes: %v", err)
	}

	pvs := s.listPersistentVolumes()

	var detailsList []*restypes.StorageClassDetails
	for i := range storageClasses.Items {
		detailsList = append(detailsList, s.processStorageClassDetails(&storageClasses.Items[i], pvs))
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

func (s *Service) processPersistentVolumeClaimDetails(pvc *corev1.PersistentVolumeClaim, pods *corev1.PodList) *restypes.PersistentVolumeClaimDetails {
	details := &restypes.PersistentVolumeClaimDetails{
		Kind:         "PersistentVolumeClaim",
		Name:         pvc.Name,
		Namespace:    pvc.Namespace,
		Age:          common.FormatAge(pvc.CreationTimestamp.Time),
		Status:       string(pvc.Status.Phase),
		StorageClass: pvc.Spec.StorageClassName,
		VolumeName:   pvc.Spec.VolumeName,
		Labels:       pvc.Labels,
		Annotations:  pvc.Annotations,
	}

	for _, mode := range pvc.Spec.AccessModes {
		details.AccessModes = append(details.AccessModes, string(mode))
	}

	if pvc.Status.Capacity != nil {
		if storage, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
			details.Capacity = storage.String()
		}
	} else if pvc.Spec.Resources.Requests != nil {
		if storage, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			details.Capacity = storage.String()
		}
	}

	if pvc.Spec.VolumeMode != nil {
		details.VolumeMode = string(*pvc.Spec.VolumeMode)
	} else {
		details.VolumeMode = "Filesystem"
	}

	if pvc.Spec.Selector != nil && pvc.Spec.Selector.MatchLabels != nil {
		details.Selector = pvc.Spec.Selector.MatchLabels
	}

	if pvc.Spec.DataSource != nil {
		details.DataSource = &restypes.DataSourceInfo{
			Kind: pvc.Spec.DataSource.Kind,
			Name: pvc.Spec.DataSource.Name,
		}
	} else if pvc.Spec.DataSourceRef != nil {
		details.DataSource = &restypes.DataSourceInfo{
			Kind: pvc.Spec.DataSourceRef.Kind,
			Name: pvc.Spec.DataSourceRef.Name,
		}
	}

	for _, condition := range pvc.Status.Conditions {
		condStr := fmt.Sprintf("%s: %s", condition.Type, condition.Status)
		if condition.Reason != "" {
			condStr += fmt.Sprintf(" (%s)", condition.Reason)
		}
		if condition.Message != "" {
			condStr += fmt.Sprintf(" - %s", condition.Message)
		}
		details.Conditions = append(details.Conditions, condStr)
	}

	if pods != nil {
		for _, pod := range pods.Items {
			for _, volume := range pod.Spec.Volumes {
				if volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName == pvc.Name {
					details.MountedBy = append(details.MountedBy, pod.Name)
					break
				}
			}
		}
	}

	storageClassInfo := "default"
	if details.StorageClass != nil {
		storageClassInfo = *details.StorageClass
	}

	mountInfo := ""
	if len(details.MountedBy) > 0 {
		mountInfo = fmt.Sprintf(", %d pod(s)", len(details.MountedBy))
	}

	details.Details = fmt.Sprintf("%s, %s, %s%s", details.Status, details.Capacity, storageClassInfo, mountInfo)

	return details
}

func (s *Service) processStorageClassDetails(storageClass *storagev1.StorageClass, pvs *corev1.PersistentVolumeList) *restypes.StorageClassDetails {
	details := &restypes.StorageClassDetails{
		Kind:         "StorageClass",
		Name:         storageClass.Name,
		Age:          common.FormatAge(storageClass.CreationTimestamp.Time),
		Provisioner:  storageClass.Provisioner,
		Parameters:   storageClass.Parameters,
		MountOptions: storageClass.MountOptions,
		Labels:       storageClass.Labels,
		Annotations:  storageClass.Annotations,
	}

	if storageClass.Annotations != nil {
		if val, ok := storageClass.Annotations["storageclass.kubernetes.io/is-default-class"]; ok && val == "true" {
			details.IsDefault = true
		}
	}

	if storageClass.ReclaimPolicy != nil {
		details.ReclaimPolicy = string(*storageClass.ReclaimPolicy)
	} else {
		details.ReclaimPolicy = "Delete"
	}

	if storageClass.VolumeBindingMode != nil {
		details.VolumeBindingMode = string(*storageClass.VolumeBindingMode)
	} else {
		details.VolumeBindingMode = "Immediate"
	}

	if storageClass.AllowVolumeExpansion != nil {
		details.AllowVolumeExpansion = *storageClass.AllowVolumeExpansion
	}

	if storageClass.AllowedTopologies != nil {
		for _, topology := range storageClass.AllowedTopologies {
			selector := restypes.TopologySelector{}
			for _, expr := range topology.MatchLabelExpressions {
				selector.MatchLabelExpressions = append(selector.MatchLabelExpressions, restypes.TopologyLabelRequirement{
					Key:    expr.Key,
					Values: expr.Values,
				})
			}
			details.AllowedTopologies = append(details.AllowedTopologies, selector)
		}
	}

	if pvs != nil {
		for _, pv := range pvs.Items {
			if pv.Spec.StorageClassName == storageClass.Name {
				details.PersistentVolumes = append(details.PersistentVolumes, pv.Name)
			}
		}
	}

	provisionerInfo := storageClass.Provisioner
	if details.IsDefault {
		provisionerInfo += " (default)"
	}

	policyInfo := fmt.Sprintf("Reclaim: %s, Binding: %s", details.ReclaimPolicy, details.VolumeBindingMode)

	expansionInfo := ""
	if details.AllowVolumeExpansion {
		expansionInfo = ", Expandable"
	}

	pvInfo := ""
	if len(details.PersistentVolumes) > 0 {
		pvInfo = fmt.Sprintf(", %d PV(s)", len(details.PersistentVolumes))
	}

	details.Details = fmt.Sprintf("%s, %s%s%s", provisionerInfo, policyInfo, expansionInfo, pvInfo)

	return details
}

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil
	}
	return pods
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
