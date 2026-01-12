package admission

import (
	"fmt"
	"sort"
	"strings"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func convertWebhook(
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
	reinvocationPolicy *admissionregistrationv1.ReinvocationPolicyType,
) restypes.WebhookDetails {
	details := restypes.WebhookDetails{
		Name:                    name,
		AdmissionReviewVersions: append([]string{}, admissionVersions...),
	}

	if clientConfig.Service != nil {
		details.ClientConfig.Service = &restypes.WebhookService{
			Namespace: clientConfig.Service.Namespace,
			Name:      clientConfig.Service.Name,
			Path:      clientConfig.Service.Path,
			Port:      clientConfig.Service.Port,
		}
	}
	if clientConfig.URL != nil {
		details.ClientConfig.URL = *clientConfig.URL
	}

	if failurePolicy != nil {
		details.FailurePolicy = string(*failurePolicy)
	}
	if matchPolicy != nil {
		details.MatchPolicy = string(*matchPolicy)
	}
	if sideEffects != nil {
		details.SideEffects = string(*sideEffects)
	}
	if timeoutSeconds != nil {
		details.TimeoutSeconds = timeoutSeconds
	}
	if reinvocationPolicy != nil {
		details.ReinvocationPolicy = string(*reinvocationPolicy)
	}

	for _, rule := range rules {
		converted := restypes.WebhookRule{
			APIGroups:   append([]string{}, rule.APIGroups...),
			APIVersions: append([]string{}, rule.APIVersions...),
			Resources:   append([]string{}, rule.Resources...),
		}
		for _, op := range rule.Operations {
			converted.Operations = append(converted.Operations, string(op))
		}
		if rule.Scope != nil {
			converted.Scope = string(*rule.Scope)
		}
		details.Rules = append(details.Rules, converted)
	}

	if namespaceSelector != nil {
		details.NamespaceSelector = convertSelector(namespaceSelector)
	}
	if objectSelector != nil {
		details.ObjectSelector = convertSelector(objectSelector)
	}

	return details
}

func convertSelector(selector *metav1.LabelSelector) *restypes.WebhookSelector {
	converted := &restypes.WebhookSelector{}
	if selector.MatchLabels != nil {
		converted.MatchLabels = selector.MatchLabels
	}
	for _, expr := range selector.MatchExpressions {
		converted.MatchExpressions = append(converted.MatchExpressions, restypes.WebhookSelectorExpression{
			Key:      expr.Key,
			Operator: string(expr.Operator),
			Values:   append([]string{}, expr.Values...),
		})
	}
	return converted
}

func summarizeWebhookConfiguration(count int, selector *metav1.LabelSelector) string {
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
	if s.deps.Logger != nil {
		s.deps.Logger.Error(msg, "ResourceLoader")
	}
}
