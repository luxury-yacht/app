/*
 * backend/resources/persistentvolumeclaim/details.go
 *
 * PersistentVolumeClaim resource handlers, co-located in the per-kind package.
 */

package persistentvolumeclaim

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed PersistentVolumeClaim views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a PersistentVolumeClaim service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil
	}
	return pods
}

// PersistentVolumeClaim returns the detailed view for a single PVC.
func (s *Service) PersistentVolumeClaim(namespace, name string) (*PersistentVolumeClaimDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvc, err := s.deps.KubernetesClient.CoreV1().PersistentVolumeClaims(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get PVC %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get PVC: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	return s.processPersistentVolumeClaimDetails(pvc, pods), nil
}

func (s *Service) processPersistentVolumeClaimDetails(pvc *corev1.PersistentVolumeClaim, pods *corev1.PodList) *PersistentVolumeClaimDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: pods},
	)
	model := BuildResourceModel(s.deps.ClusterID, pvc)
	facts := BuildFacts(pvc, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks})
	details := &PersistentVolumeClaimDetails{
		Kind:             "PersistentVolumeClaim",
		Name:             pvc.Name,
		Namespace:        pvc.Namespace,
		StatusProjection: restypes.NewStatusProjection(model.Status),
		StorageClass:     pvc.Spec.StorageClassName,
		VolumeName:       pvc.Spec.VolumeName,
		Labels:           pvc.Labels,
		Annotations:      pvc.Annotations,
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
		details.DataSource = &DataSourceInfo{
			Kind: pvc.Spec.DataSource.Kind,
			Name: pvc.Spec.DataSource.Name,
		}
	} else if pvc.Spec.DataSourceRef != nil {
		details.DataSource = &DataSourceInfo{
			Kind: pvc.Spec.DataSourceRef.Kind,
			Name: pvc.Spec.DataSourceRef.Name,
		}
	}

	details.Conditions = restypes.FormatConditions(facts.Conditions)
	details.MountedBy = restypes.ObjectRefsFromResourceLinks(facts.MountedBy)

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
