/*
 * backend/resources/storage/storage_classes.go
 *
 * StorageClass resource handlers.
 * - Builds detail and list views for the frontend.
 */

package storage

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) StorageClass(name string) (*restypes.StorageClassDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	sc, err := s.deps.KubernetesClient.StorageV1().StorageClasses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get storage class %s: %v", name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get storage class: %v", err)
	}

	pvs := s.listPersistentVolumes()
	return s.processStorageClassDetails(sc, pvs), nil
}

func (s *Service) StorageClasses() ([]*restypes.StorageClassDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	storageClasses, err := s.deps.KubernetesClient.StorageV1().StorageClasses().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list storage classes: %v", err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list storage classes: %v", err)
	}

	pvs := s.listPersistentVolumes()

	var detailsList []*restypes.StorageClassDetails
	for i := range storageClasses.Items {
		detailsList = append(detailsList, s.processStorageClassDetails(&storageClasses.Items[i], pvs))
	}

	return detailsList, nil
}

// processStorageClassDetails processes a StorageClass object and returns its details.
// It includes information about the storage class itself and lists persistent volumes using this storage class.
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

	// List persistent volumes associated with this storage class
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
