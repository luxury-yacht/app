package admission

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ValidatingWebhookConfiguration returns details for a single validating configuration.
func (s *Service) ValidatingWebhookConfiguration(name string) (*restypes.ValidatingWebhookConfigurationDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	config, err := client.AdmissionregistrationV1().ValidatingWebhookConfigurations().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get validating webhook configuration %s: %v", name, err))
		return nil, fmt.Errorf("failed to get validating webhook configuration: %v", err)
	}

	return s.buildValidatingWebhookConfigurationDetails(config), nil
}

// ValidatingWebhookConfigurations lists all validating webhook configurations.
func (s *Service) ValidatingWebhookConfigurations() ([]*restypes.ValidatingWebhookConfigurationDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	configs, err := client.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list validating webhook configurations: %v", err))
		return nil, fmt.Errorf("failed to list validating webhook configurations: %v", err)
	}

	result := make([]*restypes.ValidatingWebhookConfigurationDetails, 0, len(configs.Items))
	for i := range configs.Items {
		result = append(result, s.buildValidatingWebhookConfigurationDetails(&configs.Items[i]))
	}

	return result, nil
}

func (s *Service) buildValidatingWebhookConfigurationDetails(config *admissionregistrationv1.ValidatingWebhookConfiguration) *restypes.ValidatingWebhookConfigurationDetails {
	details := &restypes.ValidatingWebhookConfigurationDetails{
		Kind:        "ValidatingWebhookConfiguration",
		Name:        config.Name,
		Age:         common.FormatAge(config.CreationTimestamp.Time),
		Labels:      config.Labels,
		Annotations: config.Annotations,
	}

	details.Webhooks = convertValidatingWebhooks(config.Webhooks)
	var selector *metav1.LabelSelector
	if len(config.Webhooks) > 0 {
		selector = config.Webhooks[0].NamespaceSelector
	}
	details.Details = summarizeWebhookConfiguration(len(config.Webhooks), selector)

	return details
}

func convertValidatingWebhooks(webhooks []admissionregistrationv1.ValidatingWebhook) []restypes.WebhookDetails {
	result := make([]restypes.WebhookDetails, 0, len(webhooks))
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
			nil,
		))
	}
	return result
}
