/*
 * backend/resources/types/admission.go
 *
 * Type definitions for Admission resources.
 * - Shared data structures for API responses.
 */

package types

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// MutatingWebhookConfigurationDetails captures detailed mutating webhook configuration information.
type MutatingWebhookConfigurationDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	Webhooks    []WebhookDetails  `json:"webhooks"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// ValidatingWebhookConfigurationDetails captures detailed validating webhook configuration information.
type ValidatingWebhookConfigurationDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	Webhooks    []WebhookDetails  `json:"webhooks"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// WebhookDetails describes a single webhook entry shared across mutating/validating types.
type WebhookDetails struct {
	Name                    string              `json:"name"`
	ClientConfig            WebhookClientConfig `json:"clientConfig"`
	Rules                   []WebhookRule       `json:"rules"`
	FailurePolicy           string              `json:"failurePolicy,omitempty"`
	MatchPolicy             string              `json:"matchPolicy,omitempty"`
	NamespaceSelector       *WebhookSelector    `json:"namespaceSelector,omitempty"`
	ObjectSelector          *WebhookSelector    `json:"objectSelector,omitempty"`
	SideEffects             string              `json:"sideEffects,omitempty"`
	TimeoutSeconds          *int32              `json:"timeoutSeconds,omitempty"`
	AdmissionReviewVersions []string            `json:"admissionReviewVersions,omitempty"`
	ReinvocationPolicy      string              `json:"reinvocationPolicy,omitempty"`
}

// WebhookClientConfig represents service or URL targeting.
type WebhookClientConfig struct {
	Service *WebhookService `json:"service,omitempty"`
	URL     string          `json:"url,omitempty"`
}

// WebhookService references a Kubernetes service target.
type WebhookService struct {
	Namespace string  `json:"namespace"`
	Name      string  `json:"name"`
	Path      *string `json:"path,omitempty"`
	Port      *int32  `json:"port,omitempty"`
}

// WebhookRule captures rule matching for a webhook.
type WebhookRule struct {
	APIGroups   []string `json:"apiGroups,omitempty"`
	APIVersions []string `json:"apiVersions,omitempty"`
	Resources   []string `json:"resources,omitempty"`
	Operations  []string `json:"operations,omitempty"`
	Scope       string   `json:"scope,omitempty"`
}

// WebhookSelector holds selector criteria.
type WebhookSelector struct {
	MatchLabels      map[string]string           `json:"matchLabels,omitempty"`
	MatchExpressions []WebhookSelectorExpression `json:"matchExpressions,omitempty"`
}

// WebhookSelectorExpression represents a label selector requirement.
type WebhookSelectorExpression struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
}

// WebhookCondition summarises webhook condition text.
type WebhookCondition struct {
	Type    string       `json:"type"`
	Status  string       `json:"status"`
	Reason  string       `json:"reason,omitempty"`
	Message string       `json:"message,omitempty"`
	Time    *metav1.Time `json:"time,omitempty"`
}
