package admission

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildMutatingResourceModelServiceRefs(t *testing.T) {
	path := "/mutate"
	port := int32(9443)
	failurePolicy := admissionregistrationv1.Fail
	matchPolicy := admissionregistrationv1.Equivalent
	sideEffects := admissionregistrationv1.SideEffectClassNone
	timeout := int32(10)
	reinvocation := admissionregistrationv1.IfNeededReinvocationPolicy
	scope := admissionregistrationv1.NamespacedScope

	config := &admissionregistrationv1.MutatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: "mutating.example.com", UID: "uid-2"},
		Webhooks: []admissionregistrationv1.MutatingWebhook{{
			Name:                    "pods.example.com",
			AdmissionReviewVersions: []string{"v1", "v1beta1"},
			ClientConfig: admissionregistrationv1.WebhookClientConfig{
				Service: &admissionregistrationv1.ServiceReference{
					Namespace: "webhooks",
					Name:      "mutator",
					Path:      &path,
					Port:      &port,
				},
			},
			Rules: []admissionregistrationv1.RuleWithOperations{{
				Operations: []admissionregistrationv1.OperationType{admissionregistrationv1.Create, admissionregistrationv1.Update},
				Rule: admissionregistrationv1.Rule{
					APIGroups:   []string{""},
					APIVersions: []string{"v1"},
					Resources:   []string{"pods"},
					Scope:       &scope,
				},
			}},
			NamespaceSelector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"team": "platform"},
				MatchExpressions: []metav1.LabelSelectorRequirement{{
					Key:      "environment",
					Operator: metav1.LabelSelectorOpIn,
					Values:   []string{"prod", "staging"},
				}},
			},
			FailurePolicy:      &failurePolicy,
			MatchPolicy:        &matchPolicy,
			SideEffects:        &sideEffects,
			TimeoutSeconds:     &timeout,
			ReinvocationPolicy: &reinvocation,
		}},
	}

	model := BuildMutatingResourceModel("cluster-a", config)
	require.Equal(t, "1 webhook", model.Status.Label)

	facts := BuildMutatingFacts("cluster-a", config)
	require.Len(t, facts.Webhooks, 1)
	webhook := facts.Webhooks[0]
	require.Equal(t, "pods.example.com", webhook.Name)
	require.Equal(t, []string{"v1", "v1beta1"}, webhook.AdmissionReviewVersions)
	require.Equal(t, "Fail", webhook.FailurePolicy)
	require.Equal(t, "Equivalent", webhook.MatchPolicy)
	require.Equal(t, "None", webhook.SideEffects)
	require.Equal(t, int32(10), *webhook.TimeoutSeconds)
	require.Equal(t, "IfNeeded", webhook.ReinvocationPolicy)
	require.Equal(t, "webhooks", webhook.ClientConfig.Service.Namespace)
	require.Equal(t, "mutator", webhook.ClientConfig.Service.Name)
	require.Equal(t, "/mutate", *webhook.ClientConfig.Service.Path)
	require.Equal(t, int32(9443), *webhook.ClientConfig.Service.Port)
	require.Equal(t, &resourcemodel.ResourceRef{
		ClusterID: "cluster-a",
		Group:     "",
		Version:   "v1",
		Kind:      "Service",
		Resource:  "services",
		Namespace: "webhooks",
		Name:      "mutator",
	}, webhook.ClientConfig.Service.Service.Ref)
	require.Equal(t, map[string]string{"team": "platform"}, webhook.NamespaceSelector.MatchLabels)
	require.Equal(t, "environment", webhook.NamespaceSelector.MatchExpressions[0].Key)
	require.Equal(t, []string{"CREATE", "UPDATE"}, webhook.Rules[0].Operations)
	require.Equal(t, []string{"pods"}, webhook.Rules[0].Resources)
	require.Equal(t, "Namespaced", webhook.Rules[0].Scope)
}

func TestBuildValidatingResourceModelURLRefs(t *testing.T) {
	url := "https://webhooks.example.com/validate"
	config := &admissionregistrationv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: "validating.example.com", UID: "uid-3"},
		Webhooks: []admissionregistrationv1.ValidatingWebhook{{
			Name:         "validate.example.com",
			ClientConfig: admissionregistrationv1.WebhookClientConfig{URL: &url},
		}},
	}

	model := BuildValidatingResourceModel("cluster-a", config)
	require.Equal(t, "1 webhook", model.Status.Label)

	facts := BuildValidatingFacts("cluster-a", config)
	require.Equal(t, "https://webhooks.example.com/validate", facts.Webhooks[0].ClientConfig.URL)
	require.Nil(t, facts.Webhooks[0].ClientConfig.Service)
}
