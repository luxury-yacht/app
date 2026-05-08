package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildCustomResourceDefinitionResourceModelFactsStatusAndVersions(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "uid-1"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural:     "widgets",
				Singular:   "widget",
				Kind:       "Widget",
				ListKind:   "WidgetList",
				ShortNames: []string{"wdg"},
				Categories: []string{"all"},
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1beta1", Served: true, Storage: false, Deprecated: true},
				{
					Name:    "v1",
					Served:  true,
					Storage: true,
					Schema: &apiextensionsv1.CustomResourceValidation{
						OpenAPIV3Schema: &apiextensionsv1.JSONSchemaProps{Type: "object"},
					},
				},
				{Name: "v2alpha1", Served: false, Storage: false},
			},
			Conversion: &apiextensionsv1.CustomResourceConversion{Strategy: apiextensionsv1.WebhookConverter},
		},
		Status: apiextensionsv1.CustomResourceDefinitionStatus{
			Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{{
				Type:   apiextensionsv1.Established,
				Status: apiextensionsv1.ConditionTrue,
				Reason: "InitialNamesAccepted",
			}},
		},
	}

	model := BuildCustomResourceDefinitionResourceModel("cluster-a", crd)

	require.Equal(t, ResourceRef{
		ClusterID: "cluster-a",
		Group:     "apiextensions.k8s.io",
		Version:   "v1",
		Kind:      "CustomResourceDefinition",
		Resource:  "customresourcedefinitions",
		Name:      "widgets.example.com",
		UID:       "uid-1",
	}, model.Ref)
	facts := model.Facts.CustomResourceDefinition
	require.NotNil(t, facts)
	require.Equal(t, "example.com", facts.Group)
	require.Equal(t, "Namespaced", facts.Scope)
	require.Equal(t, "Widget", facts.Names.Kind)
	require.Equal(t, []string{"wdg"}, facts.Names.ShortNames)
	require.Equal(t, "Webhook", facts.ConversionStrategy)
	require.Equal(t, "v1", facts.StorageVersion)
	require.Equal(t, 1, facts.ExtraServedVersionCount)
	require.Equal(t, "Versions: v1beta1,v1*,v2alpha1", CustomResourceDefinitionVersionDetails(*facts))
	require.False(t, facts.Versions[0].HasSchema)
	require.True(t, facts.Versions[1].HasSchema)
	require.Equal(t, "Established", facts.Conditions[0].Type)
	require.Equal(t, "True", facts.Conditions[0].Status)
	require.Equal(t, "Versions: v1beta1,v1*,v2alpha1", model.Status.Label)
	require.Equal(t, "v1", model.Status.State)
}

func TestBuildCustomResourceDefinitionFactsFallsBackToServedVersion(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1alpha1", Served: false},
				{Name: "v1beta1", Served: true},
				{Name: "v1", Served: true},
			},
		},
	}

	facts := BuildCustomResourceDefinitionFacts(crd)

	require.Equal(t, "v1beta1", facts.StorageVersion)
	require.Equal(t, 1, facts.ExtraServedVersionCount)
}

func TestBuildMutatingWebhookConfigurationResourceModelServiceRefs(t *testing.T) {
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

	model := BuildMutatingWebhookConfigurationResourceModel("cluster-a", config)

	require.Equal(t, "1 webhook", model.Status.Label)
	facts := model.Facts.MutatingWebhookConfiguration
	require.NotNil(t, facts)
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
	require.Equal(t, &ResourceRef{
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

func TestBuildValidatingWebhookConfigurationResourceModelURLRefs(t *testing.T) {
	url := "https://webhooks.example.com/validate"
	config := &admissionregistrationv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: "validating.example.com", UID: "uid-3"},
		Webhooks: []admissionregistrationv1.ValidatingWebhook{{
			Name:         "validate.example.com",
			ClientConfig: admissionregistrationv1.WebhookClientConfig{URL: &url},
		}},
	}

	model := BuildValidatingWebhookConfigurationResourceModel("cluster-a", config)

	facts := model.Facts.ValidatingWebhookConfiguration
	require.NotNil(t, facts)
	require.Equal(t, "https://webhooks.example.com/validate", facts.Webhooks[0].ClientConfig.URL)
	require.Nil(t, facts.Webhooks[0].ClientConfig.Service)
	require.Equal(t, "1 webhook", model.Status.Label)
}
