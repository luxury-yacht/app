/*
 * backend/resources/secret/details.go
 *
 * Secret resource handlers, co-located in the per-kind package. Intrinsic fields
 * come from the single model (secret.Facts).
 */

package secret

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed Secret views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a Secret service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Secret returns the detailed view for a single secret.
func (s *Service) Secret(namespace, name string) (*SecretDetails, error) {
	sec, err := s.deps.KubernetesClient.CoreV1().Secrets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get secret %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get secret: %v", err)
	}

	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: s.listNamespacePods(namespace)},
	)
	return s.processSecretDetails(sec, relationships), nil
}

// Secrets returns detailed views for all secrets in the namespace.
func (s *Service) Secrets(namespace string) ([]*SecretDetails, error) {
	secrets, err := s.deps.KubernetesClient.CoreV1().Secrets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list secrets: %v", err)
	}

	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{Pods: s.listNamespacePods(namespace)},
	)

	var detailsList []*SecretDetails
	for i := range secrets.Items {
		detailsList = append(detailsList, s.processSecretDetails(&secrets.Items[i], relationships))
	}

	return detailsList, nil
}

func (s *Service) processSecretDetails(sec *corev1.Secret, relationships *resourcemodel.ResourceRelationshipIndex) *SecretDetails {
	facts := BuildFacts(sec, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks})
	details := &SecretDetails{
		Kind:        "Secret",
		Name:        sec.Name,
		Namespace:   sec.Namespace,
		Age:         common.FormatAge(sec.CreationTimestamp.Time),
		SecretType:  facts.Type,
		DataKeys:    facts.DataKeys,
		DataCount:   facts.DataCount,
		Labels:      sec.Labels,
		Annotations: sec.Annotations,
		Data:        make(map[string]string, len(sec.Data)),
	}

	for key, value := range sec.Data {
		details.Data[key] = string(value)
	}

	details.UsedBy = restypes.ObjectRefsFromResourceLinks(facts.UsedBy)

	details.Details = fmt.Sprintf("%s, %d key(s)", details.SecretType, details.DataCount)
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
