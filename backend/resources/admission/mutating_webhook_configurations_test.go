package admission

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	"k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgotesting "k8s.io/client-go/testing"
)

func TestServiceMutatingWebhookConfigurationDetails(t *testing.T) {
	t.Helper()

	sideEffectsNone := admissionregistrationv1.SideEffectClassNone
	failPolicy := admissionregistrationv1.Fail
	matchPolicy := admissionregistrationv1.Equivalent
	reinvokePolicy := admissionregistrationv1.IfNeededReinvocationPolicy
	timeout := int32(10)
	allScope := admissionregistrationv1.AllScopes

	config := &admissionregistrationv1.MutatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "webhook-mutate",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-15 * time.Minute)),
			Labels:            map[string]string{"app": "web"},
		},
		Webhooks: []admissionregistrationv1.MutatingWebhook{{
			Name:                    "pods.mutate.tld",
			AdmissionReviewVersions: []string{"v1"},
			ClientConfig: admissionregistrationv1.WebhookClientConfig{
				Service: &admissionregistrationv1.ServiceReference{
					Namespace: "web",
					Name:      "mutator",
					Path:      ptrToString("/mutate"),
					Port:      ptrToInt32(9443),
				},
			},
			Rules: []admissionregistrationv1.RuleWithOperations{{
				Operations: []admissionregistrationv1.OperationType{admissionregistrationv1.Create},
				Rule: admissionregistrationv1.Rule{
					APIGroups:   []string{""},
					APIVersions: []string{"v1"},
					Resources:   []string{"pods"},
					Scope:       &allScope,
				},
			}},
			NamespaceSelector:  &metav1.LabelSelector{MatchLabels: map[string]string{"env": "prod"}},
			ObjectSelector:     &metav1.LabelSelector{MatchLabels: map[string]string{"tier": "frontend"}},
			FailurePolicy:      &failPolicy,
			MatchPolicy:        &matchPolicy,
			SideEffects:        &sideEffectsNone,
			TimeoutSeconds:     &timeout,
			ReinvocationPolicy: &reinvokePolicy,
		}, {
			Name:                    "configmaps.mutate.tld",
			AdmissionReviewVersions: []string{"v1"},
			ClientConfig: admissionregistrationv1.WebhookClientConfig{
				URL: ptrToString("https://example.com/hook"),
			},
			Rules: []admissionregistrationv1.RuleWithOperations{{
				Operations: []admissionregistrationv1.OperationType{admissionregistrationv1.Update},
				Rule: admissionregistrationv1.Rule{
					APIGroups:   []string{""},
					APIVersions: []string{"v1"},
					Resources:   []string{"configmaps"},
				},
			}},
		}},
	}

	service := newAdmissionService(t, config.DeepCopy())

	detail, err := service.MutatingWebhookConfiguration("webhook-mutate")
	require.NoError(t, err)

	require.Equal(t, "MutatingWebhookConfiguration", detail.Kind)
	require.Equal(t, "webhook-mutate", detail.Name)
	require.Len(t, detail.Webhooks, 2)
	require.Contains(t, detail.Details, "2 webhook(s)")
	require.Contains(t, detail.Details, "env=prod")

	first := detail.Webhooks[0]
	require.Equal(t, "pods.mutate.tld", first.Name)
	require.Equal(t, "Fail", first.FailurePolicy)
	require.Equal(t, "Equivalent", first.MatchPolicy)
	require.Equal(t, "None", first.SideEffects)
	require.Equal(t, []string{"CREATE"}, first.Rules[0].Operations)
	require.NotNil(t, first.NamespaceSelector)
	require.Equal(t, "frontend", first.ObjectSelector.MatchLabels["tier"])
	require.NotNil(t, first.ClientConfig.Service)
	require.Equal(t, "mutator", first.ClientConfig.Service.Name)
	require.NotNil(t, first.TimeoutSeconds)
	require.Equal(t, int32(10), *first.TimeoutSeconds)
	require.Equal(t, string(admissionregistrationv1.IfNeededReinvocationPolicy), first.ReinvocationPolicy)
}

func TestMutatingWebhookConfigurationLogsErrorOnFailure(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("get", "mutatingwebhookconfigurations", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	_, err := service.MutatingWebhookConfiguration("hook-one")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get mutating webhook configuration")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to get mutating webhook configuration hook-one: boom")
}
