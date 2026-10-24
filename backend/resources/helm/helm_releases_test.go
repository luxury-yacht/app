/*
 * backend/resources/helm/helm_releases_test.go
 *
 * Tests for Helm release operations.
 * - Covers Helm release operations behavior and edge cases.
 */

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
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/resources/common"
	sentryreporting "github.com/luxury-yacht/app/internal/sentry"
)

type recordingHelmLogger struct {
	cause     error
	operation sentryreporting.Operation
}

func (*recordingHelmLogger) Debug(string, ...string) {}
func (*recordingHelmLogger) Info(string, ...string)  {}
func (*recordingHelmLogger) Warn(string, ...string)  {}
func (*recordingHelmLogger) Error(string, ...string) {}

func (l *recordingHelmLogger) ErrorWithCauseAndOperation(
	err error,
	_ string,
	operation sentryreporting.Operation,
	_ ...string,
) {
	l.cause = err
	l.operation = operation
}

type testResourceResolver map[schema.GroupVersionKind]common.ResolvedResource

func (r testResourceResolver) ResolveResourceForGVK(_ context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	resolved, ok := r[gvk]
	return resolved, ok, nil
}

var helmTestResourceResolver = testResourceResolver{
	{Group: "", Version: "v1", Kind: "ConfigMap"}: {
		Group: "", Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespaced: true,
	},
	{Group: "", Version: "v1", Kind: "Service"}: {
		Group: "", Version: "v1", Kind: "Service", Resource: "services", Namespaced: true,
	},
	{Group: "apps", Version: "v1", Kind: "Deployment"}: {
		Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespaced: true,
	},
	{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole"}: {
		Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole", Resource: "clusterroles", Namespaced: false,
	},
}

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

func TestExtractResourcesFromManifestDoesNotDefaultClusterScopedNamespace(t *testing.T) {
	t.Helper()

	manifest := `
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: reader
---
apiVersion: databases.example.com/v1alpha1
kind: Database
metadata:
  name: orders
---
`

	service := &Service{deps: Dependencies{Common: common.Dependencies{ResourceResolver: helmTestResourceResolver}}}
	resources := service.extractResourcesFromManifest(context.Background(), manifest, "release-ns")

	require.Equal(t, []HelmResource{
		{Kind: "ClusterRole", APIVersion: "rbac.authorization.k8s.io/v1", Name: "reader", Namespace: "", Scope: "cluster"},
		{Kind: "Database", APIVersion: "databases.example.com/v1alpha1", Name: "orders", Namespace: "release-ns"},
	}, resources)
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

	details, err := service.ReleaseDetails(context.Background(), "default", "demo")
	require.NoError(t, err)

	require.Equal(t, "helmrelease", details.Kind)
	require.Equal(t, "demo", details.Name)
	require.Equal(t, "default", details.Namespace)
	require.Equal(t, "demo-1.2.3", details.Chart)
	require.Equal(t, "2.0.0", details.AppVersion)
	require.Equal(t, 2, details.Revision)
	require.Equal(t, "deployed", details.Status)
	require.Equal(t, "deployed", details.StatusState)
	require.Equal(t, "ready", details.StatusPresentation)
	require.Equal(t, "info.status", details.StatusReason)
	require.Equal(t, current.Config, details.Values)
	require.Equal(t, "Upgrade complete", details.Description)
	require.Equal(t, "All good", details.Notes)
	require.Equal(t, map[string]string{"owner": "platform"}, details.Labels)
	require.Len(t, details.Resources, 2)
	require.Len(t, details.History, 2)
	require.Equal(t, 1, details.History[0].Revision)
	require.Equal(t, "superseded", details.History[0].Status)
	require.Equal(t, "ready", details.History[0].StatusPresentation)
	require.Equal(t, "info.status", details.History[0].StatusReason)
	require.Equal(t, 2, details.History[1].Revision)
	require.Equal(t, "deployed", details.History[1].Status)
	require.Equal(t, "ready", details.History[1].StatusPresentation)
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

	_, err := service.ReleaseDetails(context.Background(), "default", "demo")
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

	_, err := service.ReleaseDetails(context.Background(), "default", "missing")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get release")
}

// The Values tab compares what the chart ships, what the user supplied, and
// what Helm rendered with; all three must come from the same stored revision.
func TestReleaseValuesBuildsChartDefaultsMergedAndOverridesFromOneRevision(t *testing.T) {
	release := buildTestRelease("demo", "observability", 4, time.Now().Add(-4*time.Hour), time.Now().Add(-30*time.Minute))
	release.Chart.Values = map[string]interface{}{
		"replicaCount":   1,
		"image":          map[string]interface{}{"repository": "nginx", "tag": ""},
		"podAnnotations": map[string]interface{}{},
		"legacy":         "chart",
	}
	release.Chart.SetDependencies(&chart.Chart{
		Metadata: &chart.Metadata{Name: "redis", Version: "1.0.0"},
		Values:   map[string]interface{}{"port": 6379},
	})
	release.Config = map[string]interface{}{
		"replicaCount": 3,
		"image":        map[string]interface{}{"tag": "v2"},
		"legacy":       nil,
	}
	service := newHelmServiceWithReleases(t, "observability", release)

	values, revision, err := service.ReleaseValues("observability", "demo")
	require.NoError(t, err)
	require.Equal(t, 4, revision)

	// Defaults keep overridden keys, empty maps, and subchart defaults.
	require.Equal(t, map[string]interface{}{
		"replicaCount":   1,
		"image":          map[string]interface{}{"repository": "nginx", "tag": ""},
		"podAnnotations": map[string]interface{}{},
		"legacy":         "chart",
		"redis":          map[string]interface{}{"port": 6379, "global": map[string]interface{}{}},
	}, values.Defaults)
	// Merged is what Helm rendered with: overrides win and null removes a key.
	require.Equal(t, map[string]interface{}{
		"replicaCount":   3,
		"image":          map[string]interface{}{"repository": "nginx", "tag": "v2"},
		"podAnnotations": map[string]interface{}{},
		"redis":          map[string]interface{}{"port": 6379, "global": map[string]interface{}{}},
	}, values.Merged)
	// Overrides are the user-supplied values exactly, including the null.
	require.Equal(t, map[string]interface{}{
		"replicaCount": 3,
		"image":        map[string]interface{}{"tag": "v2"},
		"legacy":       nil,
	}, values.Overrides)
}

// The Values tab marks subchart copies of global overrides, which needs the
// value path of every subchart, nested ones included.
func TestReleaseValuesReportsNestedSubchartPaths(t *testing.T) {
	release := buildTestRelease("demo", "observability", 2, time.Now().Add(-time.Hour), time.Now())
	sentinel := &chart.Chart{Metadata: &chart.Metadata{Name: "sentinel", Version: "1.0.0"}}
	redis := &chart.Chart{Metadata: &chart.Metadata{Name: "redis", Version: "1.0.0"}}
	redis.SetDependencies(sentinel)
	release.Chart.SetDependencies(redis, &chart.Chart{Metadata: &chart.Metadata{Name: "postgresql", Version: "1.0.0"}})
	service := newHelmServiceWithReleases(t, "observability", release)

	values, _, err := service.ReleaseValues("observability", "demo")
	require.NoError(t, err)
	require.Equal(t, [][]string{{"redis"}, {"redis", "sentinel"}, {"postgresql"}}, values.SubchartPaths)
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

	_, _, err := service.ReleaseManifest("default", "web")
	require.Error(t, err)
	require.Contains(t, err.Error(), "no kube client")
}

func TestReleaseManifestInitError(t *testing.T) {
	tempDir := t.TempDir()
	missingConfig := filepath.Join(tempDir, "missing-kubeconfig")

	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient:       func(string) error { return nil },
			SelectedKubeconfig: missingConfig,
		},
	})

	_, _, err := service.ReleaseManifest("default", "web")
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

	_, err := service.ReleaseDetails(context.Background(), "default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure fail")
}

func TestReleaseValuesEnsureClientError(t *testing.T) {
	service := NewService(Dependencies{Common: common.Dependencies{
		EnsureClient: func(string) error { return fmt.Errorf("ensure") },
	}})

	_, _, err := service.ReleaseValues("default", "demo")
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

// A failure before the uninstall runs must be reported by DeleteRelease itself:
// the gateway no longer wraps Helm uninstall in a fallback capture.
func TestDeleteReleaseReportsSetupFailures(t *testing.T) {
	setupErr := errors.New("setup failed")
	tests := []struct {
		name string
		deps func(*recordingHelmLogger) Dependencies
	}{
		{
			name: "client unavailable",
			deps: func(logger *recordingHelmLogger) Dependencies {
				return Dependencies{Common: common.Dependencies{
					EnsureClient: func(string) error { return setupErr },
					Logger:       logger,
				}}
			},
		},
		{
			name: "action configuration fails",
			deps: func(logger *recordingHelmLogger) Dependencies {
				return Dependencies{
					Common: common.Dependencies{
						EnsureClient: func(string) error { return nil },
						Logger:       logger,
					},
					ActionConfigFactory: func(*cli.EnvSettings, string) (*action.Configuration, error) {
						return nil, setupErr
					},
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger := &recordingHelmLogger{}
			err := NewService(tt.deps(logger)).DeleteRelease("default", "demo")

			require.ErrorIs(t, err, setupErr)
			require.ErrorIs(t, logger.cause, setupErr, "the setup failure is reported")
			require.True(t, errorcapture.IsTelemetryHandled(err), "the returned error is marked reported")
		})
	}
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
	logger := &recordingHelmLogger{}
	service := NewService(Dependencies{
		Common: common.Dependencies{
			EnsureClient: func(string) error { return nil },
			Logger:       logger,
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
	require.Error(t, logger.cause)
	require.Equal(t,
		common.DynamicResourceRequestOperation(common.DynamicResourceRequestSpec{
			Action: "delete", Group: "helm.sh", Version: "v3", Resource: "releases", Namespaced: true,
		}).WithPrivateResourceNames("missing"),
		logger.operation,
	)
}

func TestReleaseManifestReturnsContent(t *testing.T) {
	rel := buildTestRelease("demo", "ns1", 6, time.Now().Add(-time.Hour), time.Now())
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

	out, revision, err := service.ReleaseManifest("ns1", "demo")
	require.NoError(t, err)
	require.Equal(t, "kind: ConfigMap", out)
	require.Equal(t, 6, revision)
}
