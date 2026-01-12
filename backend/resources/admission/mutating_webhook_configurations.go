/*
 * backend/resources/admission/mutating_webhook_configurations.go
 *
 * Mutating Webhook Configurations resource handlers.
 * - Builds detail and list views for the frontend.
 */

package admission

import (
	"fmt"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// MutatingWebhookConfiguration returns details for a single mutating configuration.
func (s *Service) MutatingWebhookConfiguration(name string) (*types.MutatingWebhookConfigurationDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	config, err := client.AdmissionregistrationV1().MutatingWebhookConfigurations().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get mutating webhook configuration %s: %v", name, err))
		return nil, fmt.Errorf("failed to get mutating webhook configuration: %v", err)
	}

	return s.buildMutatingWebhookConfigurationDetails(config), nil
}

// MutatingWebhookConfigurations lists all mutating webhook configurations.
func (s *Service) MutatingWebhookConfigurations() ([]*types.MutatingWebhookConfigurationDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	configs, err := client.AdmissionregistrationV1().MutatingWebhookConfigurations().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list mutating webhook configurations: %v", err))
		return nil, fmt.Errorf("failed to list mutating webhook configurations: %v", err)
	}

	result := make([]*types.MutatingWebhookConfigurationDetails, 0, len(configs.Items))
	for i := range configs.Items {
		result = append(result, s.buildMutatingWebhookConfigurationDetails(&configs.Items[i]))
	}

	return result, nil
}

func (s *Service) buildMutatingWebhookConfigurationDetails(config *admissionregistrationv1.MutatingWebhookConfiguration) *types.MutatingWebhookConfigurationDetails {
	details := &types.MutatingWebhookConfigurationDetails{
		Kind:        "MutatingWebhookConfiguration",
		Name:        config.Name,
		Age:         common.FormatAge(config.CreationTimestamp.Time),
		Labels:      config.Labels,
		Annotations: config.Annotations,
	}

	details.Webhooks = convertMutatingWebhooks(config.Webhooks)
	var selector *metav1.LabelSelector
	if len(config.Webhooks) > 0 {
		selector = config.Webhooks[0].NamespaceSelector
	}
	details.Details = summarizeWebhookConfiguration(len(config.Webhooks), selector)

	return details
}

func convertMutatingWebhooks(webhooks []admissionregistrationv1.MutatingWebhook) []types.WebhookDetails {
	result := make([]types.WebhookDetails, 0, len(webhooks))
	for i := range webhooks {
		result = append(result, convertWebhook(
			webhooks[i].Name,
			webhooks[i].AdmissionReviewVersions,
			webhooks[i].ClientConfig,
			webhooks[i].Rules,
			webhooks[i].NamespaceSelector,
			webhooks[i].ObjectSelector,
			webhooks[i].FailurePolicy,
			webhooks[i].MatchPolicy,
			webhooks[i].SideEffects,
			webhooks[i].TimeoutSeconds,
			webhooks[i].ReinvocationPolicy,
		))
	}
	return result
}

func TestMutatingWebhookConfigurationRequiresClient(t *testing.T) {
	service := NewService(common.Dependencies{})

	_, err := service.MutatingWebhookConfiguration("hook-one")

	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}
