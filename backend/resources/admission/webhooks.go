package admission

import (
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Dependencies captures collaborators needed for admission resources.
type Dependencies struct {
	Common common.Dependencies
}

// Service exposes helpers for mutating/validating webhook configurations.
type Service struct {
	deps Dependencies
}

// NewService constructs a new admission Service.
func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

// MutatingWebhookConfiguration returns details for a single mutating configuration.
func (s *Service) MutatingWebhookConfiguration(name string) (*restypes.MutatingWebhookConfigurationDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	config, err := client.AdmissionregistrationV1().MutatingWebhookConfigurations().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get mutating webhook configuration %s: %v", name, err))
		return nil, fmt.Errorf("failed to get mutating webhook configuration: %v", err)
	}

	return s.buildMutatingWebhookConfigurationDetails(config), nil
}

// MutatingWebhookConfigurations lists all mutating webhook configurations.
func (s *Service) MutatingWebhookConfigurations() ([]*restypes.MutatingWebhookConfigurationDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	configs, err := client.AdmissionregistrationV1().MutatingWebhookConfigurations().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list mutating webhook configurations: %v", err))
		return nil, fmt.Errorf("failed to list mutating webhook configurations: %v", err)
	}

	result := make([]*restypes.MutatingWebhookConfigurationDetails, 0, len(configs.Items))
	for i := range configs.Items {
		result = append(result, s.buildMutatingWebhookConfigurationDetails(&configs.Items[i]))
	}

	return result, nil
}

// ValidatingWebhookConfiguration returns details for a single validating configuration.
func (s *Service) ValidatingWebhookConfiguration(name string) (*restypes.ValidatingWebhookConfigurationDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	config, err := client.AdmissionregistrationV1().ValidatingWebhookConfigurations().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get validating webhook configuration %s: %v", name, err))
		return nil, fmt.Errorf("failed to get validating webhook configuration: %v", err)
	}

	return s.buildValidatingWebhookConfigurationDetails(config), nil
}

// ValidatingWebhookConfigurations lists all validating webhook configurations.
func (s *Service) ValidatingWebhookConfigurations() ([]*restypes.ValidatingWebhookConfigurationDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	configs, err := client.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(s.deps.Common.Context, metav1.ListOptions{})
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

func (s *Service) buildMutatingWebhookConfigurationDetails(config *admissionregistrationv1.MutatingWebhookConfiguration) *restypes.MutatingWebhookConfigurationDetails {
	details := &restypes.MutatingWebhookConfigurationDetails{
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

func convertMutatingWebhooks(webhooks []admissionregistrationv1.MutatingWebhook) []restypes.WebhookDetails {
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
			webhooks[i].ReinvocationPolicy,
		))
	}
	return result
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
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, "ResourceLoader")
	}
}
