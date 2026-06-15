/*
 * backend/resources/admission/facts.go
 *
 * Canonical webhook-configuration facts for the admission pair (Mutating +
 * Validating). The two kinds share the WebhookFacts base + sub-types; Service links
 * reference the shared resourcemodel.ResourceLink primitive.
 */

package admission

import "github.com/luxury-yacht/app/backend/resourcemodel"

// MutatingWebhookConfigurationFacts is the canonical MutatingWebhookConfiguration facts.
type MutatingWebhookConfigurationFacts struct {
	Webhooks []MutatingWebhookFacts `json:"webhooks,omitempty"`
}

// ValidatingWebhookConfigurationFacts is the canonical ValidatingWebhookConfiguration facts.
type ValidatingWebhookConfigurationFacts struct {
	Webhooks []ValidatingWebhookFacts `json:"webhooks,omitempty"`
}

// WebhookFacts is the shared base for a single webhook entry.
type WebhookFacts struct {
	Name                    string                   `json:"name,omitempty"`
	AdmissionReviewVersions []string                 `json:"admissionReviewVersions,omitempty"`
	ClientConfig            WebhookClientConfigFacts `json:"clientConfig"`
	FailurePolicy           string                   `json:"failurePolicy,omitempty"`
	MatchPolicy             string                   `json:"matchPolicy,omitempty"`
	SideEffects             string                   `json:"sideEffects,omitempty"`
	TimeoutSeconds          *int32                   `json:"timeoutSeconds,omitempty"`
	NamespaceSelector       *LabelSelectorFacts      `json:"namespaceSelector,omitempty"`
	ObjectSelector          *LabelSelectorFacts      `json:"objectSelector,omitempty"`
	Rules                   []WebhookRuleFacts       `json:"rules,omitempty"`
}

// MutatingWebhookFacts adds the mutating-only reinvocation policy.
type MutatingWebhookFacts struct {
	WebhookFacts
	ReinvocationPolicy string `json:"reinvocationPolicy,omitempty"`
}

// ValidatingWebhookFacts is a validating webhook entry.
type ValidatingWebhookFacts struct {
	WebhookFacts
}

// WebhookClientConfigFacts is the service-or-URL client targeting facts.
type WebhookClientConfigFacts struct {
	Service *WebhookServiceFacts `json:"service,omitempty"`
	URL     string               `json:"url,omitempty"`
}

// WebhookServiceFacts references a Kubernetes service target.
type WebhookServiceFacts struct {
	Namespace string                      `json:"namespace,omitempty"`
	Name      string                      `json:"name,omitempty"`
	Path      *string                     `json:"path,omitempty"`
	Port      *int32                      `json:"port,omitempty"`
	Service   *resourcemodel.ResourceLink `json:"service,omitempty"`
}

// WebhookRuleFacts captures one rule-matching block.
type WebhookRuleFacts struct {
	APIGroups   []string `json:"apiGroups,omitempty"`
	APIVersions []string `json:"apiVersions,omitempty"`
	Resources   []string `json:"resources,omitempty"`
	Operations  []string `json:"operations,omitempty"`
	Scope       string   `json:"scope,omitempty"`
}

// LabelSelectorFacts is a webhook namespace/object selector.
type LabelSelectorFacts struct {
	MatchLabels      map[string]string               `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorRequirementFacts `json:"matchExpressions,omitempty"`
}

// LabelSelectorRequirementFacts is a single selector requirement.
type LabelSelectorRequirementFacts struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
}
