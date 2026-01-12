/*
 * backend/resources/admission/validating_webhook_configurations_test.go
 *
 * Tests for Validating Webhook Configurations resource handlers.
 * - Covers Validating Webhook Configurations resource handlers behavior and edge cases.
 */

package admission

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

func TestServiceValidatingWebhookConfigurations(t *testing.T) {
	t.Helper()

	config := &admissionregistrationv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "webhook-validate",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-20 * time.Minute)),
		},
		Webhooks: []admissionregistrationv1.ValidatingWebhook{{
			Name:                    "pods.validate.tld",
			AdmissionReviewVersions: []string{"v1", "v1beta1"},
			ClientConfig: admissionregistrationv1.WebhookClientConfig{
				Service: &admissionregistrationv1.ServiceReference{
					Namespace: "web",
					Name:      "validator",
				},
			},
		}},
	}

	service := newAdmissionService(t, config.DeepCopy())

	list, err := service.ValidatingWebhookConfigurations()
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, "ValidatingWebhookConfiguration", list[0].Kind)
	require.Equal(t, "webhook-validate", list[0].Name)
	require.Len(t, list[0].Webhooks, 1)
}

func TestValidatingWebhookConfigurationListLogsError(t *testing.T) {
	logger := &capturingLogger{}
	// Use the client-go fake so the client satisfies kubernetes.Interface.
	client := cgofake.NewClientset()
	client.PrependReactor("list", "validatingwebhookconfigurations", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("no list")
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           logger,
		KubernetesClient: client,
	})

	_, err := service.ValidatingWebhookConfigurations()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list validating webhook configurations")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to list validating webhook configurations: no list")
}
