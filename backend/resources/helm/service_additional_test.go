package helm

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"

	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestReleaseDetailsEnsureClientError(t *testing.T) {
	service := NewService(Dependencies{Common: common.Dependencies{
		EnsureClient: func(kind string) error {
			require.Equal(t, "HelmRelease", kind)
			return fmt.Errorf("ensure fail")
		},
	}})

	_, err := service.ReleaseDetails("default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure fail")
}

func TestReleaseValuesEnsureClientError(t *testing.T) {
	service := NewService(Dependencies{Common: common.Dependencies{
		EnsureClient: func(string) error { return fmt.Errorf("ensure") },
	}})

	_, err := service.ReleaseValues("default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure")
}

func TestDeleteReleaseEnsureClientError(t *testing.T) {
	service := NewService(Dependencies{Common: common.Dependencies{
		EnsureClient: func(string) error { return fmt.Errorf("ensure") },
	}})

	err := service.DeleteRelease("default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure")
}

func TestDeleteReleaseRemovesRelease(t *testing.T) {
	release := buildTestRelease("demo", "default", 1, time.Now().Add(-2*time.Hour), time.Now().Add(-time.Hour))
	store := storage.Init(driver.NewMemory())
	require.NoError(t, store.Create(release))

	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
		},
		ActionConfigFactory: func(*cli.EnvSettings, string) (*action.Configuration, error) {
			return &action.Configuration{
				Releases:   store,
				Log:        func(string, ...interface{}) {},
				KubeClient: &fakeKubeClient{},
			}, nil
		},
	})

	err := service.DeleteRelease("default", "demo")
	require.NoError(t, err)

	_, err = store.Get("demo", 1)
	require.Error(t, err)
}

func TestDeleteReleaseMissingReturnsError(t *testing.T) {
	store := storage.Init(driver.NewMemory())
	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
		},
		ActionConfigFactory: func(*cli.EnvSettings, string) (*action.Configuration, error) {
			return &action.Configuration{
				Releases:   store,
				Log:        func(string, ...interface{}) {},
				KubeClient: &fakeKubeClient{},
			}, nil
		},
	})

	err := service.DeleteRelease("default", "missing")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to delete Helm release")
}

func TestReleaseManifestReturnsContent(t *testing.T) {
	rel := buildTestRelease("demo", "ns1", 1, time.Now().Add(-time.Hour), time.Now())
	rel.Manifest = "kind: ConfigMap"
	store := storage.Init(driver.NewMemory())
	require.NoError(t, store.Create(rel))

	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
		},
		ActionConfigFactory: func(*cli.EnvSettings, string) (*action.Configuration, error) {
			return &action.Configuration{
				Releases:   store,
				Log:        func(string, ...interface{}) {},
				KubeClient: &fakeKubeClient{},
			}, nil
		},
	})

	out, err := service.ReleaseManifest("ns1", "demo")
	require.NoError(t, err)
	require.Equal(t, "kind: ConfigMap", out)
}
