/*
 * backend/resources/persistentvolumeclaim/details_test.go
 *
 * Tests for the PersistentVolumeClaim detail service (co-located with the kind).
 */

package persistentvolumeclaim_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type logEntry struct {
	level   string
	message string
}

type capturingLogger struct {
	entries []logEntry
}

func (l *capturingLogger) Debug(msg string, _ ...string) { l.entries = append(l.entries, logEntry{"DEBUG", msg}) }
func (l *capturingLogger) Info(msg string, _ ...string)  { l.entries = append(l.entries, logEntry{"INFO", msg}) }
func (l *capturingLogger) Warn(msg string, _ ...string)  { l.entries = append(l.entries, logEntry{"WARN", msg}) }
func (l *capturingLogger) Error(msg string, _ ...string) { l.entries = append(l.entries, logEntry{"ERROR", msg}) }

func newService(t testing.TB, client *fake.Clientset) *persistentvolumeclaim.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	)
	return persistentvolumeclaim.NewService(deps)
}

func TestServicePersistentVolumeClaimDetailsUsesSharedStatus(t *testing.T) {
	pvc := testsupport.PersistentVolumeClaimFixture("default", "data")
	client := fake.NewClientset(pvc.DeepCopy())
	service := newService(t, client)

	detail, err := service.PersistentVolumeClaim("default", "data")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolumeClaim", detail.Kind)
	require.Equal(t, string(corev1.ClaimBound), detail.Status)
	require.Equal(t, string(corev1.ClaimBound), detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
}

func TestPersistentVolumeClaimsListLogsError(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("list", "persistentvolumeclaims", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("no pvc list")
	})

	service := persistentvolumeclaim.NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           logger,
		KubernetesClient: client,
	})

	_, err := service.PersistentVolumeClaims("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list PVCs")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to list PVCs in namespace default: no pvc list")
}
