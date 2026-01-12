package storage

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil
	}
	return pods
}

func (s *Service) PersistentVolumeClaim(namespace, name string) (*restypes.PersistentVolumeClaimDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvc, err := s.deps.KubernetesClient.CoreV1().PersistentVolumeClaims(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get PVC %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get PVC: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	return s.processPersistentVolumeClaimDetails(pvc, pods), nil
}

func (s *Service) PersistentVolumeClaims(namespace string) ([]*restypes.PersistentVolumeClaimDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvcs, err := s.deps.KubernetesClient.CoreV1().PersistentVolumeClaims(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list PVCs in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list PVCs: %v", err)
	}

	pods := s.listNamespacePods(namespace)

	var detailsList []*restypes.PersistentVolumeClaimDetails
	for i := range pvcs.Items {
		detailsList = append(detailsList, s.processPersistentVolumeClaimDetails(&pvcs.Items[i], pods))
	}

	return detailsList, nil
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
