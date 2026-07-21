/*
 * backend/resources/persistentvolumeclaim/details_test.go
 *
 * Tests for the PersistentVolumeClaim detail service (co-located with the kind).
 */

package persistentvolumeclaim_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/testsupport"
)

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
