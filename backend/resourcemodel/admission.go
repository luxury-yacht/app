package resourcemodel

import (
	"fmt"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const admissionRegistrationAPIGroup = "admissionregistration.k8s.io"

func BuildMutatingWebhookConfigurationResourceModel(clusterID string, config *admissionregistrationv1.MutatingWebhookConfiguration) ResourceModel {
	facts := BuildMutatingWebhookConfigurationFacts(clusterID, config)
	status := BuildWebhookConfigurationStatusPresentation(config.ObjectMeta, len(facts.Webhooks))
	return networkResourceModel(clusterID, admissionRegistrationAPIGroup, "v1", "MutatingWebhookConfiguration", "mutatingwebhookconfigurations", ResourceScopeCluster, config.ObjectMeta, status, ResourceFacts{MutatingWebhookConfiguration: &facts})
}

func BuildMutatingWebhookConfigurationFacts(clusterID string, config *admissionregistrationv1.MutatingWebhookConfiguration) MutatingWebhookConfigurationFacts {
	facts := MutatingWebhookConfigurationFacts{
		Webhooks: make([]MutatingWebhookFacts, 0, len(config.Webhooks)),
	}
	for _, webhook := range config.Webhooks {
		facts.Webhooks = append(facts.Webhooks, MutatingWebhookFacts{
			WebhookFacts:       buildWebhookFacts(clusterID, webhook.Name, webhook.AdmissionReviewVersions, webhook.ClientConfig, webhook.Rules, webhook.NamespaceSelector, webhook.ObjectSelector, webhook.FailurePolicy, webhook.MatchPolicy, webhook.SideEffects, webhook.TimeoutSeconds),
			ReinvocationPolicy: stringPtrValue(webhook.ReinvocationPolicy),
		})
	}
	return facts
}

func BuildValidatingWebhookConfigurationResourceModel(clusterID string, config *admissionregistrationv1.ValidatingWebhookConfiguration) ResourceModel {
	facts := BuildValidatingWebhookConfigurationFacts(clusterID, config)
	status := BuildWebhookConfigurationStatusPresentation(config.ObjectMeta, len(facts.Webhooks))
	return networkResourceModel(clusterID, admissionRegistrationAPIGroup, "v1", "ValidatingWebhookConfiguration", "validatingwebhookconfigurations", ResourceScopeCluster, config.ObjectMeta, status, ResourceFacts{ValidatingWebhookConfiguration: &facts})
}

func BuildValidatingWebhookConfigurationFacts(clusterID string, config *admissionregistrationv1.ValidatingWebhookConfiguration) ValidatingWebhookConfigurationFacts {
	facts := ValidatingWebhookConfigurationFacts{
		Webhooks: make([]ValidatingWebhookFacts, 0, len(config.Webhooks)),
	}
	for _, webhook := range config.Webhooks {
		facts.Webhooks = append(facts.Webhooks, ValidatingWebhookFacts{
			WebhookFacts: buildWebhookFacts(clusterID, webhook.Name, webhook.AdmissionReviewVersions, webhook.ClientConfig, webhook.Rules, webhook.NamespaceSelector, webhook.ObjectSelector, webhook.FailurePolicy, webhook.MatchPolicy, webhook.SideEffects, webhook.TimeoutSeconds),
		})
	}
	return facts
}

func BuildWebhookConfigurationStatusPresentation(meta metav1.ObjectMeta, count int) ResourceStatusPresentation {
	state := fmt.Sprintf("%d", count)
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "webhooks",
		Status: state,
	}}
	lifecycle := NetworkLifecycle(meta)
	if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return NetworkSourceStatus(WebhookCountDetails(count), state, "", "ready", signals, lifecycle)
}

func WebhookCountDetails(count int) string {
	if count == 1 {
		return "1 webhook"
	}
	return fmt.Sprintf("%d webhooks", count)
}

func buildWebhookFacts(
	clusterID string,
	name string,
	admissionVersions []string,
	clientConfig admissionregistrationv1.WebhookClientConfig,
	rules []admissionregistrationv1.RuleWithOperations,
	namespaceSelector *metav1.LabelSelector,
	objectSelector *metav1.LabelSelector,
	failurePolicy *admissionregistrationv1.FailurePolicyType,
	matchPolicy *admissionregistrationv1.MatchPolicyType,
	sideEffects *admissionregistrationv1.SideEffectClass,
	timeoutSeconds *int32,
) WebhookFacts {
	return WebhookFacts{
		Name:                    name,
		AdmissionReviewVersions: append([]string(nil), admissionVersions...),
		ClientConfig:            webhookClientConfigFacts(clusterID, clientConfig),
		FailurePolicy:           stringPtrValue(failurePolicy),
		MatchPolicy:             stringPtrValue(matchPolicy),
		SideEffects:             stringPtrValue(sideEffects),
		TimeoutSeconds:          copyInt32Ptr(timeoutSeconds),
		NamespaceSelector:       labelSelectorFacts(namespaceSelector),
		ObjectSelector:          labelSelectorFacts(objectSelector),
		Rules:                   webhookRuleFacts(rules),
	}
}

func webhookClientConfigFacts(clusterID string, config admissionregistrationv1.WebhookClientConfig) WebhookClientConfigFacts {
	facts := WebhookClientConfigFacts{}
	if config.Service != nil {
		service := WebhookServiceFacts{
			Namespace: config.Service.Namespace,
			Name:      config.Service.Name,
			Path:      copyStringPtr(config.Service.Path),
			Port:      copyInt32Ptr(config.Service.Port),
		}
		if service.Namespace != "" && service.Name != "" {
			link := namespacedResourceLink(clusterID, "", "v1", "Service", "services", service.Namespace, service.Name, "")
			service.Service = &link
		}
		facts.Service = &service
	}
	if config.URL != nil {
		facts.URL = *config.URL
	}
	return facts
}

func webhookRuleFacts(rules []admissionregistrationv1.RuleWithOperations) []WebhookRuleFacts {
	if len(rules) == 0 {
		return nil
	}
	facts := make([]WebhookRuleFacts, 0, len(rules))
	for _, rule := range rules {
		next := WebhookRuleFacts{
			APIGroups:   append([]string(nil), rule.APIGroups...),
			APIVersions: append([]string(nil), rule.APIVersions...),
			Resources:   append([]string(nil), rule.Resources...),
		}
		for _, op := range rule.Operations {
			next.Operations = append(next.Operations, string(op))
		}
		if rule.Scope != nil {
			next.Scope = string(*rule.Scope)
		}
		facts = append(facts, next)
	}
	return facts
}

func labelSelectorFacts(selector *metav1.LabelSelector) *LabelSelectorFacts {
	if selector == nil {
		return nil
	}
	facts := &LabelSelectorFacts{
		MatchLabels: CopyStringMap(selector.MatchLabels),
	}
	for _, expr := range selector.MatchExpressions {
		facts.MatchExpressions = append(facts.MatchExpressions, LabelSelectorRequirementFacts{
			Key:      expr.Key,
			Operator: string(expr.Operator),
			Values:   append([]string(nil), expr.Values...),
		})
	}
	return facts
}

func stringPtrValue[T ~string](value *T) string {
	if value == nil {
		return ""
	}
	return string(*value)
}

func copyStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copyInt32Ptr(value *int32) *int32 {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}
