package helm

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestReleaseManifestEnsureClientError(t *testing.T) {
	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(kind string) error {
				require.Equal(t, "HelmRelease", kind)
				return errors.New("no kube client")
			},
		},
	})

	_, err := service.ReleaseManifest("default", "web")
	require.Error(t, err)
	require.Contains(t, err.Error(), "no kube client")
}

func TestReleaseManifestInitError(t *testing.T) {
	tempDir := t.TempDir()
	missingConfig := filepath.Join(tempDir, "missing-kubeconfig")

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:            context.Background(),
			EnsureClient:       func(string) error { return nil },
			SelectedKubeconfig: missingConfig,
		},
	})

	_, err := service.ReleaseManifest("default", "web")
	require.Error(t, err)
	require.Contains(t, err.Error(), "Kubernetes cluster unreachable")
}
