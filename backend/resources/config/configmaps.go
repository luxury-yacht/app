/*
 * backend/resources/config/configmaps.go
 *
 * ConfigMap resource handlers.
 * - Builds detail and list views for the frontend.
 */

package config

import (
	"encoding/base64"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) ConfigMap(namespace, name string) (*types.ConfigMapDetails, error) {
	cm, err := s.deps.KubernetesClient.CoreV1().ConfigMaps(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get configmap %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get configmap: %v", err)
	}

	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: s.listNamespacePods(namespace)},
	)
	return s.processConfigMapDetails(cm, relationships), nil
}

func (s *Service) ConfigMaps(namespace string) ([]*types.ConfigMapDetails, error) {
	configMaps, err := s.deps.KubernetesClient.CoreV1().ConfigMaps(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list configmaps in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list configmaps: %v", err)
	}

	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: s.listNamespacePods(namespace)},
	)

	var detailsList []*types.ConfigMapDetails
	for i := range configMaps.Items {
		detailsList = append(detailsList, s.processConfigMapDetails(&configMaps.Items[i], relationships))
	}

	return detailsList, nil
}

func (s *Service) processConfigMapDetails(cm *corev1.ConfigMap, relationships *resourcemodel.ResourceRelationshipIndex) *types.ConfigMapDetails {
	model := resourcemodel.BuildConfigMapResourceModel(
		s.deps.ClusterID,
		cm,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	facts := model.Facts.ConfigMap
	dataCount := len(cm.Data) + len(cm.BinaryData)
	if facts != nil {
		dataCount = facts.DataCount
	}
	details := &types.ConfigMapDetails{
		Kind:        "ConfigMap",
		Name:        cm.Name,
		Namespace:   cm.Namespace,
		Age:         common.FormatAge(cm.CreationTimestamp.Time),
		Data:        cm.Data,
		DataCount:   dataCount,
		Labels:      cm.Labels,
		Annotations: cm.Annotations,
	}

	if len(cm.BinaryData) > 0 {
		details.BinaryData = make(map[string]string, len(cm.BinaryData))
		for key, value := range cm.BinaryData {
			details.BinaryData[key] = base64.StdEncoding.EncodeToString(value)
		}
	}

	if facts != nil {
		details.UsedBy = types.ObjectRefsFromResourceLinks(facts.UsedBy)
	}

	details.Details = fmt.Sprintf("Data items: %d", details.DataCount)
	if len(details.UsedBy) > 0 {
		details.Details += fmt.Sprintf(", Used by %d pod(s)", len(details.UsedBy))
	}

	return details
}

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil
	}
	return pods
}
