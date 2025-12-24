package admission

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clientgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestMutatingWebhookConfigurationRequiresClient(t *testing.T) {
	service := NewService(Dependencies{})

	_, err := service.MutatingWebhookConfiguration("hook-one")

	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
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

func TestValidatingWebhookConfigurationListLogsError(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("list", "validatingwebhookconfigurations", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("no list")
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	_, err := service.ValidatingWebhookConfigurations()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list validating webhook configurations")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to list validating webhook configurations: no list")
}

type logEntry struct {
	level   string
	message string
}

type capturingLogger struct {
	entries []logEntry
}

func (l *capturingLogger) Debug(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "DEBUG", message: msg})
}

func (l *capturingLogger) Info(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "INFO", message: msg})
}

func (l *capturingLogger) Warn(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "WARN", message: msg})
}

func (l *capturingLogger) Error(msg string, source ...string) {
	l.entries = append(l.entries, logEntry{level: "ERROR", message: msg})
}
