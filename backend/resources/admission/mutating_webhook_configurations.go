/*
 * backend/resources/admission/mutating_webhook_configurations.go
 *
 * Mutating Webhook Configurations resource handlers.
 * - Builds detail and list views for the frontend.
 */

package admission

import (
	"fmt"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// MutatingWebhookConfiguration returns details for a single mutating configuration.
func (s *Service) MutatingWebhookConfiguration(name string) (*MutatingWebhookConfigurationDetails, error) {
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

func (s *Service) buildMutatingWebhookConfigurationDetails(config *admissionregistrationv1.MutatingWebhookConfiguration) *MutatingWebhookConfigurationDetails {
	model := BuildMutatingResourceModel(s.deps.ClusterID, config)
	facts := BuildMutatingFacts(s.deps.ClusterID, config)
	details := &MutatingWebhookConfigurationDetails{
		Kind:        "MutatingWebhookConfiguration",
		Name:        config.Name,
		Labels:      model.Metadata.Labels,
		Annotations: model.Metadata.Annotations,
	}

	details.Webhooks = mutatingWebhookDetailsFromFacts(facts.Webhooks)
	var selector *LabelSelectorFacts
	if len(facts.Webhooks) > 0 {
		selector = facts.Webhooks[0].NamespaceSelector
	}
	details.Details = summarizeWebhookConfiguration(len(facts.Webhooks), selector)

	return details
}
