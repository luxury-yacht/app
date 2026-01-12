package helm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/kube"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	helmTime "helm.sh/helm/v3/pkg/time"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

type fakeKubeClient struct{}

func (fakeKubeClient) Create(kube.ResourceList) (*kube.Result, error) { return &kube.Result{}, nil }
func (fakeKubeClient) Wait(kube.ResourceList, time.Duration) error    { return nil }
func (fakeKubeClient) WaitWithJobs(kube.ResourceList, time.Duration) error {
	return nil
}
func (fakeKubeClient) Delete(kube.ResourceList) (*kube.Result, []error) {
	return &kube.Result{}, nil
}
func (fakeKubeClient) WatchUntilReady(kube.ResourceList, time.Duration) error { return nil }
func (fakeKubeClient) Update(kube.ResourceList, kube.ResourceList, bool) (*kube.Result, error) {
	return &kube.Result{}, nil
}
func (fakeKubeClient) Build(io.Reader, bool) (kube.ResourceList, error) {
	return kube.ResourceList{}, nil
}
func (fakeKubeClient) WaitAndGetCompletedPodPhase(string, time.Duration) (corev1.PodPhase, error) {
	return corev1.PodSucceeded, nil
}
func (fakeKubeClient) IsReachable() error                                   { return nil }
func (fakeKubeClient) WaitForDelete(kube.ResourceList, time.Duration) error { return nil }
func (fakeKubeClient) UpdateThreeWayMerge(kube.ResourceList, kube.ResourceList, bool) (*kube.Result, error) {
	return &kube.Result{}, nil
}
func (fakeKubeClient) GetPodList(string, metav1.ListOptions) (*corev1.PodList, error) {
	return &corev1.PodList{}, nil
}
func (fakeKubeClient) OutputContainerLogsForPodList(*corev1.PodList, string, func(string, string, string) io.Writer) error {
	return nil
}
func (fakeKubeClient) DeleteWithPropagationPolicy(kube.ResourceList, metav1.DeletionPropagation) (*kube.Result, []error) {
	return &kube.Result{}, nil
}
func (fakeKubeClient) Get(kube.ResourceList, bool) (map[string][]runtime.Object, error) {
	return map[string][]runtime.Object{}, nil
}
func (fakeKubeClient) BuildTable(io.Reader, bool) (kube.ResourceList, error) {
	return kube.ResourceList{}, nil
}

func TestExtractResourcesFromManifestBuildsUniqueList(t *testing.T) {
	t.Helper()

	manifest := `
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: staging
---
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Service
    metadata:
      name: web
      namespace: prod
  - apiVersion: v1
    kind: Service
    metadata:
      name: web
      namespace: prod
---
`

	service := &Service{}
	resources := service.extractResourcesFromManifest(manifest, "default")

	require.Equal(t, []restypes.HelmResource{
		{Kind: "ConfigMap", Name: "app-config", Namespace: "default"},
		{Kind: "Deployment", Name: "web", Namespace: "staging"},
		{Kind: "Service", Name: "web", Namespace: "prod"},
	}, resources)
}

func TestExtractResourcesFromManifestIgnoresInvalidDocuments(t *testing.T) {
	t.Helper()

	manifest := `
---
kind: ""
metadata:
  name: ignored
---
apiVersion: v1
kind: Secret
metadata:
  namespace: team-a
  name: credentials
data: {}
---
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Service
    metadata: not-a-map
  - apiVersion: v1
    kind: Service
    metadata:
      name: svc
      namespace: other
---
`

	service := &Service{}
	resources := service.extractResourcesFromManifest(manifest, "team-default")

	require.Equal(t, []restypes.HelmResource{
		{Kind: "Secret", Name: "credentials", Namespace: "team-a"},
		{Kind: "Service", Name: "svc", Namespace: "other"},
	}, resources)
}

func TestExtractNameNamespaceSupportsInterfaceMap(t *testing.T) {
	obj := map[string]interface{}{
		"metadata": map[interface{}]interface{}{
			"name":      "demo",
			"namespace": "custom-ns",
		},
	}

	name, ns := extractNameNamespace(obj, "fallback")
	require.Equal(t, "demo", name)
	require.Equal(t, "custom-ns", ns)

	name, ns = extractNameNamespace(map[string]interface{}{}, "fallback")
	require.Equal(t, "", name)
	require.Equal(t, "fallback", ns)
}

func TestReleaseDetailsReturnsHistoryAndResources(t *testing.T) {
	t.Helper()

	now := time.Now()
	current := buildTestRelease("demo", "default", 2, now.Add(-3*time.Hour), now.Add(-time.Hour))
	current.Info.Description = "Upgrade complete"
	current.Info.Notes = "All good"
	current.Manifest = `
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo-config
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
`
	current.Labels = map[string]string{"owner": "platform"}

	previous := buildTestRelease("demo", "default", 1, now.Add(-6*time.Hour), now.Add(-5*time.Hour))
	previous.Info.Status = release.StatusSuperseded
	previous.Info.Description = "Initial install"
	previous.Manifest = current.Manifest

	service := newHelmServiceWithReleases(t, "default", previous, current)

	details, err := service.ReleaseDetails("default", "demo")
	require.NoError(t, err)

	require.Equal(t, "helmrelease", details.Kind)
	require.Equal(t, "demo", details.Name)
	require.Equal(t, "default", details.Namespace)
	require.Equal(t, "demo-1.2.3", details.Chart)
	require.Equal(t, "2.0.0", details.AppVersion)
	require.Equal(t, 2, details.Revision)
	require.Equal(t, "Deployed", details.Status)
	require.Equal(t, current.Config, details.Values)
	require.Equal(t, "Upgrade complete", details.Description)
	require.Equal(t, "All good", details.Notes)
	require.Equal(t, map[string]string{"owner": "platform"}, details.Labels)
	require.Len(t, details.Resources, 2)
	require.Len(t, details.History, 2)
	require.Equal(t, 1, details.History[0].Revision)
	require.Equal(t, 2, details.History[1].Revision)
}

func TestReleaseDetailsInitError(t *testing.T) {
	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
		},
		ActionConfigFactory: func(*cli.EnvSettings, string) (*action.Configuration, error) {
			return nil, fmt.Errorf("init failure")
		},
	})

	_, err := service.ReleaseDetails("default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "init failure")
}

func TestReleaseDetailsReturnsErrorWhenReleaseMissing(t *testing.T) {
	store := storage.Init(driver.NewMemory())
	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
		},
		ActionConfigFactory: func(*cli.EnvSettings, string) (*action.Configuration, error) {
			return &action.Configuration{
				Releases:   store,
				KubeClient: &fakeKubeClient{},
				Log:        func(string, ...interface{}) {},
			}, nil
		},
	})

	_, err := service.ReleaseDetails("default", "missing")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get release")
}

func TestReleaseValuesReturnsMergedMaps(t *testing.T) {
	t.Helper()

	release := buildTestRelease("demo", "observability", 3, time.Now().Add(-4*time.Hour), time.Now().Add(-30*time.Minute))
	release.Config = map[string]interface{}{
		"replicaCount": 3,
		"service": map[string]interface{}{
			"type": "ClusterIP",
		},
	}

	service := newHelmServiceWithReleases(t, "observability", release)

	values, err := service.ReleaseValues("observability", "demo")
	require.NoError(t, err)

	defaults, ok := values["defaultValues"].(map[string]interface{})
	require.True(t, ok)
	require.EqualValues(t, 1, defaults["replicaCount"])

	allValues, ok := values["allValues"].(map[string]interface{})
	require.True(t, ok)
	require.EqualValues(t, 3, allValues["replicaCount"])

	userValues, ok := values["userValues"].(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, "ClusterIP", userValues["service"].(map[string]interface{})["type"])
}

func newHelmServiceWithReleases(t *testing.T, namespace string, releases ...*release.Release) *Service {
	t.Helper()
	store := storage.Init(driver.NewMemory())
	for _, rel := range releases {
		// Ensure namespace matches the request scope.
		rel.Namespace = namespace
		require.NoError(t, store.Create(rel))
	}

	factory := func(_ *cli.EnvSettings, _ string) (*action.Configuration, error) {
		return &action.Configuration{
			Releases:   store,
			KubeClient: &fakeKubeClient{},
			Log:        func(string, ...interface{}) {},
		}, nil
	}

	return NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
		},
		ActionConfigFactory: factory,
	})
}

func buildTestRelease(name, namespace string, version int, first, last time.Time) *release.Release {
	ch := &chart.Chart{
		Metadata: &chart.Metadata{
			Name:        name,
			Version:     "1.2.3",
			AppVersion:  "2.0.0",
			Annotations: map[string]string{"maintainer": "team"},
		},
		Values: map[string]interface{}{
			"replicaCount": 1,
			"service": map[string]interface{}{
				"type": "LoadBalancer",
			},
		},
	}

	return &release.Release{
		Name:      name,
		Namespace: namespace,
		Chart:     ch,
		Config: map[string]interface{}{
			"service": map[string]interface{}{
				"type": "LoadBalancer",
			},
		},
		Manifest: "",
		Version:  version,
		Info: &release.Info{
			FirstDeployed: helmTime.Time{Time: first},
			LastDeployed:  helmTime.Time{Time: last},
			Status:        release.StatusDeployed,
			Description:   "Deploy succeeded",
			Notes:         "Chart deployed",
		},
	}
}

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
