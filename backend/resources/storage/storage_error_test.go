package storage

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

func TestPersistentVolumesRequireClient(t *testing.T) {
	service := NewService(Dependencies{})

	_, err := service.PersistentVolumes()

	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}

func TestPersistentVolumeLogsErrorOnFailure(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("get", "persistentvolumes", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	_, err := service.PersistentVolume("pv-one")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get persistent volume")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to get persistent volume pv-one: boom")
}

func TestPersistentVolumeClaimsListLogsError(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("list", "persistentvolumeclaims", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("no pvc list")
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	_, err := service.PersistentVolumeClaims("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list PVCs")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to list PVCs in namespace default: no pvc list")
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
