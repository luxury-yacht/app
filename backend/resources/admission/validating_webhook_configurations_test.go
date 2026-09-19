package admission

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	admissionv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestValidatingWebhookDetailsPreserveSelectorsAndIsolateSourceMetadata(t *testing.T) {
	config := &admissionv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: "validation", Labels: map[string]string{"team": "platform"}, Annotations: map[string]string{"owner": "original"}},
		Webhooks: []admissionv1.ValidatingWebhook{{
			Name: "policy.example.com", AdmissionReviewVersions: []string{"v1"},
			ClientConfig:      admissionv1.WebhookClientConfig{URL: ptrToString("https://example.com/validate")},
			NamespaceSelector: &metav1.LabelSelector{MatchExpressions: []metav1.LabelSelectorRequirement{{Key: "team", Operator: metav1.LabelSelectorOpIn, Values: []string{"platform"}}}},
		}},
	}
	detail, err := newAdmissionService(t, config).ValidatingWebhookConfiguration(context.Background(), config.Name)
	require.NoError(t, err)
	require.Equal(t, "ValidatingWebhookConfiguration", detail.Kind)
	require.Len(t, detail.Webhooks, 1)
	require.Equal(t, "https://example.com/validate", detail.Webhooks[0].ClientConfig.URL)
	require.Equal(t, "platform", detail.Webhooks[0].NamespaceSelector.MatchExpressions[0].Values[0])
	require.Empty(t, detail.Webhooks[0].ReinvocationPolicy)

	// These builders can consume informer-owned objects; detail edits cannot alter them.
	projected := NewService(common.Dependencies{}).buildValidatingWebhookConfigurationDetails(config)
	projected.Labels["team"] = "changed"
	projected.Annotations["owner"] = "changed"
	projected.Webhooks[0].NamespaceSelector.MatchExpressions[0].Values[0] = "changed"
	require.Equal(t, "platform", config.Labels["team"])
	require.Equal(t, "original", config.Annotations["owner"])
	require.Equal(t, "platform", config.Webhooks[0].NamespaceSelector.MatchExpressions[0].Values[0])
}

func TestValidatingWebhookDetailsHandleEmptyConfigurationAndRequestFailure(t *testing.T) {
	config := &admissionv1.ValidatingWebhookConfiguration{ObjectMeta: metav1.ObjectMeta{Name: "empty"}}
	service := newAdmissionService(t, config)
	detail, err := service.ValidatingWebhookConfiguration(context.Background(), config.Name)
	require.NoError(t, err)
	require.NotNil(t, detail.Webhooks, "the wire contract represents no webhooks as an empty list")
	require.Empty(t, detail.Webhooks)
	_, err = service.ValidatingWebhookConfiguration(context.Background(), "missing")
	require.Error(t, err)
	_, err = NewService(common.Dependencies{}).ValidatingWebhookConfiguration(context.Background(), config.Name)
	require.Error(t, err)
}
