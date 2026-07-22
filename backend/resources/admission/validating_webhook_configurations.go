/*
 * backend/resources/admission/validating_webhook_configurations.go
 *
 * Validating Webhook Configurations resource handlers.
 * - Builds detail and list views for the frontend.
 */

package admission

import (
	"fmt"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ValidatingWebhookConfiguration returns details for a single validating configuration.
func (s *Service) ValidatingWebhookConfiguration(name string) (*ValidatingWebhookConfigurationDetails, error) {
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

func (s *Service) buildValidatingWebhookConfigurationDetails(config *admissionregistrationv1.ValidatingWebhookConfiguration) *ValidatingWebhookConfigurationDetails {
	model := BuildValidatingResourceModel(s.deps.ClusterID, config)
	facts := BuildValidatingFacts(s.deps.ClusterID, config)
	details := &ValidatingWebhookConfigurationDetails{
		Kind:        "ValidatingWebhookConfiguration",
		Name:        config.Name,
		Labels:      model.Metadata.Labels,
		Annotations: model.Metadata.Annotations,
	}

	details.Webhooks = validatingWebhookDetailsFromFacts(facts.Webhooks)
	var selector *LabelSelectorFacts
	if len(facts.Webhooks) > 0 {
		selector = facts.Webhooks[0].NamespaceSelector
	}
	details.Details = summarizeWebhookConfiguration(len(facts.Webhooks), selector)

	return details
}
