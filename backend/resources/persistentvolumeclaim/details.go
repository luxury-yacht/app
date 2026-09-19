/*
 * backend/resources/persistentvolumeclaim/details.go
 *
 * PersistentVolumeClaim resource handlers, co-located in the per-kind package.
 */

package persistentvolumeclaim

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

// Service provides detailed PersistentVolumeClaim views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a PersistentVolumeClaim service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) listNamespacePods(ctx context.Context, namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil
	}
	return pods
}

// PersistentVolumeClaim returns the detailed view for a single PVC.
func (s *Service) PersistentVolumeClaim(ctx context.Context, namespace, name string) (*PersistentVolumeClaimDetails, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pvc, err := s.deps.KubernetesClient.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		err = s.deps.LogResourceRequestFailure(err, fmt.Sprintf("Failed to get PVC %s/%s", namespace, name), "get", Identity, logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get PVC: %w", err)
	}

	pods := s.listNamespacePods(ctx, namespace)
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
		DataSource:       dataSourceLink(s.deps.ClusterID, pvc),
	}

	for _, mode := range pvc.Spec.AccessModes {
		details.AccessModes = append(details.AccessModes, string(mode))
	}

	if facts.Capacity.Storage != nil {
		details.Capacity = facts.Capacity.Storage.String()
	}

	if pvc.Spec.VolumeMode != nil {
		details.VolumeMode = string(*pvc.Spec.VolumeMode)
	} else {
		details.VolumeMode = "Filesystem"
	}

	if pvc.Spec.Selector != nil && pvc.Spec.Selector.MatchLabels != nil {
		details.Selector = pvc.Spec.Selector.MatchLabels
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

func dataSourceLink(clusterID string, pvc *corev1.PersistentVolumeClaim) *resourcemodel.ResourceLink {
	source := pvc.Spec.DataSourceRef
	if local := pvc.Spec.DataSource; local != nil {
		source = &corev1.TypedObjectReference{APIGroup: local.APIGroup, Kind: local.Kind, Name: local.Name}
	}
	if source == nil {
		return nil
	}
	group := ptr.Deref(source.APIGroup, "")
	namespace := pvc.Namespace
	if source.Namespace != nil && *source.Namespace != "" {
		namespace = *source.Namespace
	}
	// A core PVC clone has a known GVK; custom data sources supply only group/kind.
	// Keep those display-only until a source supplies their version.
	if group == Identity.Group && source.Kind == Identity.Kind {
		link := resourcemodel.NewNamespacedResourceLink(resourcemodel.ResourceRef{
			ClusterID: clusterID, Group: Identity.Group, Version: Identity.Version,
			Kind: Identity.Kind, Resource: Identity.Resource, Namespace: namespace, Name: source.Name,
		})
		return &link
	}
	link := resourcemodel.NewDisplayResourceLink(clusterID, group, "", source.Kind, "", namespace, source.Name)
	return &link
}
