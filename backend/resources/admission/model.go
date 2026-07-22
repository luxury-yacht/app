/*
 * backend/resources/admission/model.go
 *
 * Webhook-configuration resource models for the admission pair (Mutating +
 * Validating). The two kinds share the WebhookFacts extraction + status/count
 * helpers. Shared model helpers are reused from resourcemodel (exported network
 * base). copyStringPtr/copyInt32Ptr live in webhooks.go (package-shared).
 */

package admission

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const apiGroup = "admissionregistration.k8s.io"

// BuildMutatingResourceModel builds the MutatingWebhookConfiguration resource model.
func BuildMutatingResourceModel(clusterID string, config *admissionregistrationv1.MutatingWebhookConfiguration) resourcemodel.ResourceModel {
	facts := BuildMutatingFacts(clusterID, config)
	status := statusPresentation(config.ObjectMeta, len(facts.Webhooks))
	return resourcemodel.KubernetesResourceModel(clusterID, apiGroup, "v1", "MutatingWebhookConfiguration", "mutatingwebhookconfigurations", resourcemodel.ResourceScopeCluster, config.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildMutatingFacts extracts the MutatingWebhookConfiguration facts.
func BuildMutatingFacts(clusterID string, config *admissionregistrationv1.MutatingWebhookConfiguration) MutatingWebhookConfigurationFacts {
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

// BuildValidatingResourceModel builds the ValidatingWebhookConfiguration resource model.
func BuildValidatingResourceModel(clusterID string, config *admissionregistrationv1.ValidatingWebhookConfiguration) resourcemodel.ResourceModel {
	facts := BuildValidatingFacts(clusterID, config)
	status := statusPresentation(config.ObjectMeta, len(facts.Webhooks))
	return resourcemodel.KubernetesResourceModel(clusterID, apiGroup, "v1", "ValidatingWebhookConfiguration", "validatingwebhookconfigurations", resourcemodel.ResourceScopeCluster, config.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildValidatingFacts extracts the ValidatingWebhookConfiguration facts.
func BuildValidatingFacts(clusterID string, config *admissionregistrationv1.ValidatingWebhookConfiguration) ValidatingWebhookConfigurationFacts {
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

func statusPresentation(meta metav1.ObjectMeta, count int) resourcemodel.ResourceStatusPresentation {
	state := fmt.Sprintf("%d", count)
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "webhooks",
		Status: state,
	}}
	lifecycle := resourcemodel.ObjectLifecycle(meta)
	if status, ok := resourcemodel.DeletingObjectStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ObjectSourceStatus(WebhookCountDetails(count), state, "", "", "ready", signals, lifecycle)
}

// WebhookCountDetails renders the "N webhook(s)" label used by both the status
// presentation and the snapshot streaming summary.
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
			link := resourcemodel.NewNamespacedResourceLink(clusterID, "", "v1", "Service", "services", service.Namespace, service.Name, "")
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
		MatchLabels: resourcemodel.CopyStringMap(selector.MatchLabels),
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
