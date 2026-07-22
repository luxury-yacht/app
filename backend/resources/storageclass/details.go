/*
 * backend/resources/storageclass/details.go
 *
 * StorageClass resource handlers, co-located in the per-kind package. Intrinsic
 * fields come from the single model (storageclass.Facts).
 */

package storageclass

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed StorageClass views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a StorageClass service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// StorageClass returns the detailed view for a single storage class.
func (s *Service) StorageClass(name string) (*StorageClassDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	sc, err := s.deps.KubernetesClient.StorageV1().StorageClasses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get storage class %s: %v", name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get storage class: %v", err)
	}

	pvs := s.listPersistentVolumes()
	return s.processStorageClassDetails(sc, pvs), nil
}

// listPersistentVolumes lists all PVs so the StorageClass detail can enumerate
// the volumes using this class. The PersistentVolume kind owns its own detail in
// resources/storage; this is the StorageClass detail's own dependency.
func (s *Service) listPersistentVolumes() *corev1.PersistentVolumeList {
	if s.deps.KubernetesClient == nil {
		return nil
	}

	pvs, err := s.deps.KubernetesClient.CoreV1().PersistentVolumes().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list persistent volumes: %v", err), logsources.ResourceLoader)
		return nil
	}
	return pvs
}

// processStorageClassDetails processes a StorageClass object and returns its details.
// It includes information about the storage class itself and lists persistent volumes using this storage class.
func (s *Service) processStorageClassDetails(storageClass *storagev1.StorageClass, pvs *corev1.PersistentVolumeList) *StorageClassDetails {
	model := BuildResourceModel(s.deps.ClusterID, storageClass)
	facts := BuildFacts(storageClass)
	details := &StorageClassDetails{
		Kind:             "StorageClass",
		Name:             storageClass.Name,
		StatusProjection: restypes.NewStatusProjection(model.Status),
		Provisioner:      storageClass.Provisioner,
		Parameters:       storageClass.Parameters,
		MountOptions:     storageClass.MountOptions,
		Labels:           storageClass.Labels,
		Annotations:      storageClass.Annotations,
		IsDefault:        facts.DefaultClass,
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
			selector := TopologySelector{}
			for _, expr := range topology.MatchLabelExpressions {
				selector.MatchLabelExpressions = append(selector.MatchLabelExpressions, TopologyLabelRequirement{
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
