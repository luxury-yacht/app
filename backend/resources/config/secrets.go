/*
 * backend/resources/config/secrets.go
 *
 * Secret resource handlers.
 * - Builds detail and list views for the frontend.
 */

package config

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) Secret(namespace, name string) (*types.SecretDetails, error) {
	secret, err := s.deps.KubernetesClient.CoreV1().Secrets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get secret %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get secret: %v", err)
	}

	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: s.listNamespacePods(namespace)},
	)
	return s.processSecretDetails(secret, relationships), nil
}

func (s *Service) Secrets(namespace string) ([]*types.SecretDetails, error) {
	secrets, err := s.deps.KubernetesClient.CoreV1().Secrets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list secrets: %v", err)
	}

	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: s.listNamespacePods(namespace)},
	)

	var detailsList []*types.SecretDetails
	for i := range secrets.Items {
		detailsList = append(detailsList, s.processSecretDetails(&secrets.Items[i], relationships))
	}

	return detailsList, nil
}

func (s *Service) processSecretDetails(secret *corev1.Secret, relationships *resourcemodel.ResourceRelationshipIndex) *types.SecretDetails {
	model := resourcemodel.BuildSecretResourceModel(
		s.deps.ClusterID,
		secret,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	facts := model.Facts.Secret
	secretType := string(secret.Type)
	dataKeys := make([]string, 0, len(secret.Data))
	dataCount := len(secret.Data)
	if facts != nil {
		secretType = facts.Type
		dataKeys = facts.DataKeys
		dataCount = facts.DataCount
	}
	details := &types.SecretDetails{
		Kind:        "Secret",
		Name:        secret.Name,
		Namespace:   secret.Namespace,
		Age:         common.FormatAge(secret.CreationTimestamp.Time),
		SecretType:  secretType,
		DataKeys:    dataKeys,
		DataCount:   dataCount,
		Labels:      secret.Labels,
		Annotations: secret.Annotations,
		Data:        make(map[string]string, len(secret.Data)),
	}

	for key, value := range secret.Data {
		details.Data[key] = string(value)
	}

	if facts != nil {
		details.UsedBy = types.ObjectRefsFromResourceLinks(facts.UsedBy)
	}

	details.Details = fmt.Sprintf("%s, %d key(s)", details.SecretType, details.DataCount)
	if len(details.UsedBy) > 0 {
		details.Details += fmt.Sprintf(", Used by %d pod(s)", len(details.UsedBy))
	}

	return details
}
