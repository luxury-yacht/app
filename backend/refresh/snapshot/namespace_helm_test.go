package snapshot

import (
	"context"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/kube"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	releasetime "helm.sh/helm/v3/pkg/time"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestNamespaceHelmBuilder(t *testing.T) {
	now := time.Now()

	memory := driver.NewMemory()
	memory.SetNamespace("")
	store := storage.Init(memory)

	releaseChart := &chart.Chart{
		Metadata: &chart.Metadata{
			Name:       "nginx",
			Version:    "1.2.3",
			AppVersion: "2.0.0",
		},
	}

	releaseInfo := &release.Info{
		Status:        release.StatusDeployed,
		FirstDeployed: releasetime.Time{Time: now.Add(-2 * time.Hour)},
		LastDeployed:  releasetime.Time{Time: now.Add(-30 * time.Minute)},
		Description:   "Deployed successfully",
		Notes:         "Follow the notes",
	}

	hRelease := &release.Release{
		Name:      "app",
		Namespace: "default",
		Version:   2,
		Chart:     releaseChart,
		Info:      releaseInfo,
	}
	require.NoError(t, store.Create(hRelease))
	memory.SetNamespace("")

	factoryInvocations := 0
	factory := func(namespace string) (*action.Configuration, error) {
		factoryInvocations++
		if namespace != "default" {
			return nil, fmt.Errorf("unexpected namespace %s", namespace)
		}
		memDriver := driver.NewMemory()
		memDriver.SetNamespace(namespace)
		copyStore := storage.Init(memDriver)
		releases, err := store.List(func(rel *release.Release) bool {
			return rel.Namespace == namespace
		})
		if err != nil {
			return nil, err
		}
		for _, rel := range releases {
			if rel == nil {
				continue
			}
			if err := copyStore.Create(rel); err != nil {
				return nil, err
			}
		}
		cfg := &action.Configuration{
			Releases:   copyStore,
			KubeClient: stubKubeClient{},
		}
		return cfg, nil
	}

	builder := &NamespaceHelmBuilder{
		factory: factory,
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceHelmDomainName, snapshot.Domain)
	require.Equal(t, uint64(2), snapshot.Version)
	require.Equal(t, 1, factoryInvocations)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Releases, 1)

	entry := payload.Releases[0]
	require.Equal(t, "app", entry.Name)
	require.Equal(t, "nginx-1.2.3", entry.Chart)
	require.Equal(t, "2.0.0", entry.AppVersion)
	require.Equal(t, "deployed", entry.Status)
	require.Equal(t, 2, entry.Revision)
	require.Equal(t, "Deployed successfully", entry.Description)
	require.Equal(t, "Follow the notes", entry.Notes)
	require.NotEmpty(t, entry.Age)
	require.NotEmpty(t, entry.Updated)
}

func TestNamespaceHelmBuilderAllNamespaces(t *testing.T) {
	now := time.Now()

	memory := driver.NewMemory()
	memory.SetNamespace("")
	store := storage.Init(memory)

	baseChart := &chart.Chart{
		Metadata: &chart.Metadata{
			Name:       "example",
			Version:    "1.0.0",
			AppVersion: "3.2.1",
		},
	}

	makeRelease := func(name, namespace string, version int) *release.Release {
		return &release.Release{
			Name:      name,
			Namespace: namespace,
			Version:   version,
			Chart:     baseChart,
			Info: &release.Info{
				Status:        release.StatusDeployed,
				FirstDeployed: releasetime.Time{Time: now.Add(-time.Duration(version) * time.Hour)},
				LastDeployed:  releasetime.Time{Time: now.Add(-30 * time.Minute)},
				Description:   fmt.Sprintf("%s deployed", name),
				Notes:         fmt.Sprintf("notes for %s", name),
			},
		}
	}

	releaseDefault := makeRelease("app-default", "default", 3)
	releaseStaging := makeRelease("app-staging", "staging", 5)

	require.NoError(t, store.Create(releaseDefault))
	require.NoError(t, store.Create(releaseStaging))
	memory.SetNamespace("")

	// Factory runs concurrently per namespace, so guard the invocation counter.
	invocations := make(map[string]int)
	var invocationsMu sync.Mutex
	factory := func(namespace string) (*action.Configuration, error) {
		switch namespace {
		case "default", "staging":
			invocationsMu.Lock()
			invocations[namespace]++
			invocationsMu.Unlock()
			memDriver := driver.NewMemory()
			memDriver.SetNamespace(namespace)
			copyStore := storage.Init(memDriver)
			releases, err := store.List(func(rel *release.Release) bool {
				return rel.Namespace == namespace
			})
			if err != nil {
				return nil, err
			}
			for _, rel := range releases {
				if rel == nil {
					continue
				}
				if err := copyStore.Create(rel); err != nil {
					return nil, err
				}
			}
			cfg := &action.Configuration{
				Releases:   copyStore,
				KubeClient: stubKubeClient{},
			}
			return cfg, nil
		default:
			return nil, fmt.Errorf("unexpected namespace %s", namespace)
		}
	}

	nsDefault := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}}
	nsStaging := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "staging"}}

	allList := action.NewList(&action.Configuration{
		Releases:   store,
		KubeClient: stubKubeClient{},
	})
	allList.All = true
	allList.AllNamespaces = true
	allReleases, err := allList.Run()
	require.NoError(t, err)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "cluster-a"}
	allSummaries, _ := mapHelmReleases(allReleases, "", meta)
	require.Len(t, allSummaries, 2)
	defaultSummaries, _ := mapHelmReleases(allReleases, "default", meta)
	require.Len(t, defaultSummaries, 1)
	stagingSummaries, _ := mapHelmReleases(allReleases, "staging", meta)
	require.Len(t, stagingSummaries, 1)

	builder := &NamespaceHelmBuilder{
		factory:         factory,
		namespaceLister: testsupport.NewNamespaceLister(t, nsDefault, nsStaging),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceHelmDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceHelmSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Releases, 2)

	namespaces := make(map[string]struct{})
	names := make(map[string]struct{})
	for _, entry := range payload.Releases {
		require.NotEmpty(t, entry.Namespace)
		require.NotEmpty(t, entry.Age)
		namespaces[entry.Namespace] = struct{}{}
		names[entry.Name] = struct{}{}
	}

	require.Len(t, namespaces, 2)
	require.Contains(t, names, "app-default")
	require.Contains(t, names, "app-staging")
	getInvocation := func(namespace string) int {
		invocationsMu.Lock()
		defer invocationsMu.Unlock()
		return invocations[namespace]
	}
	require.Equal(t, 1, getInvocation("default"))
	require.Equal(t, 1, getInvocation("staging"))
}

type stubKubeClient struct{}

func (stubKubeClient) Create(kube.ResourceList) (*kube.Result, error) { return &kube.Result{}, nil }
func (stubKubeClient) Wait(kube.ResourceList, time.Duration) error    { return nil }
func (stubKubeClient) WaitWithJobs(kube.ResourceList, time.Duration) error {
	return nil
}
func (stubKubeClient) Delete(kube.ResourceList) (*kube.Result, []error) { return &kube.Result{}, nil }
func (stubKubeClient) WatchUntilReady(kube.ResourceList, time.Duration) error {
	return nil
}
func (stubKubeClient) Update(kube.ResourceList, kube.ResourceList, bool) (*kube.Result, error) {
	return &kube.Result{}, nil
}
func (stubKubeClient) Build(io.Reader, bool) (kube.ResourceList, error) {
	return kube.ResourceList{}, nil
}
func (stubKubeClient) WaitAndGetCompletedPodPhase(string, time.Duration) (corev1.PodPhase, error) {
	return corev1.PodSucceeded, nil
}
func (stubKubeClient) IsReachable() error { return nil }
