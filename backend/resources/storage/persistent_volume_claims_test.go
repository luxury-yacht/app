/*
 * backend/resources/storage/persistent_volume_claims_test.go
 *
 * Tests for PersistentVolumeClaim resource handlers.
 * - Covers PersistentVolumeClaim resource handlers behavior and edge cases.
 */

package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestServicePersistentVolumeClaimDetailsUsesSharedStatus(t *testing.T) {
	pvc := testsupport.PersistentVolumeClaimFixture("default", "data")
	client := fake.NewClientset(pvc.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.PersistentVolumeClaim("default", "data")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolumeClaim", detail.Kind)
	require.Equal(t, string(corev1.ClaimBound), detail.Status)
	require.Equal(t, string(corev1.ClaimBound), detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
}

func TestPersistentVolumesRequireClient(t *testing.T) {
	service := NewService(common.Dependencies{})

	_, err := service.PersistentVolumes()

	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}

func TestPersistentVolumeLogsErrorOnFailure(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("get", "persistentvolumes", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           logger,
		KubernetesClient: client,
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
	client.PrependReactor("list", "persistentvolumeclaims", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("no pvc list")
	})

	service := NewService(common.Dependencies{
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
