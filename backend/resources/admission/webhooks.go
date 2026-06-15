/*
 * backend/resources/admission/webhooks.go
 *
 * Admission webhook conversion helpers.
 * - Normalizes webhook configs for UI models.
 */

package admission

import (
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
)

func mutatingWebhookDetailsFromFacts(webhooks []MutatingWebhookFacts) []WebhookDetails {
	result := make([]WebhookDetails, 0, len(webhooks))
	for _, webhook := range webhooks {
		result = append(result, webhookDetailsFromFacts(webhook.WebhookFacts, webhook.ReinvocationPolicy))
	}
	return result
}

func validatingWebhookDetailsFromFacts(webhooks []ValidatingWebhookFacts) []WebhookDetails {
	result := make([]WebhookDetails, 0, len(webhooks))
	for _, webhook := range webhooks {
		result = append(result, webhookDetailsFromFacts(webhook.WebhookFacts, ""))
	}
	return result
}

func webhookDetailsFromFacts(facts WebhookFacts, reinvocationPolicy string) WebhookDetails {
	details := WebhookDetails{
		Name:                    facts.Name,
		AdmissionReviewVersions: append([]string(nil), facts.AdmissionReviewVersions...),
		FailurePolicy:           facts.FailurePolicy,
		MatchPolicy:             facts.MatchPolicy,
		SideEffects:             facts.SideEffects,
		TimeoutSeconds:          copyInt32Ptr(facts.TimeoutSeconds),
		ReinvocationPolicy:      reinvocationPolicy,
	}

	if facts.ClientConfig.Service != nil {
		details.ClientConfig.Service = &WebhookService{
			Namespace: facts.ClientConfig.Service.Namespace,
			Name:      facts.ClientConfig.Service.Name,
			Path:      copyStringPtr(facts.ClientConfig.Service.Path),
			Port:      copyInt32Ptr(facts.ClientConfig.Service.Port),
		}
	}
	details.ClientConfig.URL = facts.ClientConfig.URL

	for _, rule := range facts.Rules {
		converted := WebhookRule{
			APIGroups:   append([]string(nil), rule.APIGroups...),
			APIVersions: append([]string(nil), rule.APIVersions...),
			Resources:   append([]string(nil), rule.Resources...),
			Operations:  append([]string(nil), rule.Operations...),
			Scope:       rule.Scope,
		}
		details.Rules = append(details.Rules, converted)
	}

	details.NamespaceSelector = webhookSelectorFromFacts(facts.NamespaceSelector)
	details.ObjectSelector = webhookSelectorFromFacts(facts.ObjectSelector)

	return details
}

func webhookSelectorFromFacts(selector *LabelSelectorFacts) *WebhookSelector {
	if selector == nil {
		return nil
	}
	converted := &WebhookSelector{}
	converted.MatchLabels = common.CopyStringMap(selector.MatchLabels)
	for _, expr := range selector.MatchExpressions {
		converted.MatchExpressions = append(converted.MatchExpressions, WebhookSelectorExpression{
			Key:      expr.Key,
			Operator: expr.Operator,
			Values:   append([]string(nil), expr.Values...),
		})
	}
	return converted
}

func summarizeWebhookConfiguration(count int, selector *LabelSelectorFacts) string {
	summary := fmt.Sprintf("%d webhook(s)", count)
	if count == 0 {
		return summary
	}

	if selector == nil || len(selector.MatchLabels) == 0 {
		return summary + ", NS: All"
	}

	pairs := make([]string, 0, len(selector.MatchLabels))
	for k, v := range selector.MatchLabels {
		pairs = append(pairs, fmt.Sprintf("%s=%s", k, v))
	}
	sort.Strings(pairs)
	return summary + ", NS: " + strings.Join(pairs, ", ")
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
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
