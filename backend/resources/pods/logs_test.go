/*
 * backend/resources/pods/logs_test.go
 *
 * Tests for Container log retrieval and follow helpers.
 * - Covers Container log retrieval and follow helpers behavior and edge cases.
 */

package pods

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
)

func podLogScope(namespace, name string) string {
	return fmt.Sprintf("cluster-a|%s:/v1:pod:%s", namespace, name)
}

func workloadLogScope(namespace, group, version, kind, name string) string {
	return fmt.Sprintf("cluster-a|%s:%s/%s:%s:%s", namespace, group, version, kind, name)
}

func testContainerLogTarget() containerlogs.SelectedTarget {
	return containerlogs.SelectedTarget{
		Namespace: "default",
		PodName:   "demo",
		Container: containerlogs.ContainerRef{Name: "app"},
	}
}

func testContainerLogRequest(tailLines int, previous bool) types.ContainerLogsFetchRequest {
	return types.ContainerLogsFetchRequest{
		TailLines: tailLines,
		Previous:  previous,
	}
}

func TestFetchContainerLogsRequiresScopeWhenRequestEmpty(t *testing.T) {
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{})
	require.Equal(t, "container logs scope is required", resp.Error)
}

func TestFetchContainerLogsRequiresScope(t *testing.T) {
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	for _, tc := range []struct {
		name string
		req  types.ContainerLogsFetchRequest
	}{
		{name: "filter option without scope", req: types.ContainerLogsFetchRequest{SelectedFilters: []string{"pod:demo"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := service.FetchContainerLogs(context.Background(), tc.req)
			require.Equal(t, "container logs scope is required", resp.Error)
		})
	}
}

func TestFetchContainerLogsExplicitEmptySelectionSkipsKubernetesReads(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("*", "*", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("unexpected kubernetes read")
	})
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	response := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
		Scope:     podLogScope("default", "demo"),
		MatchNone: true,
	})

	require.Empty(t, response.Error)
	require.Empty(t, response.Entries)
}

func TestFetchContainerLogsUnsupportedWorkload(t *testing.T) {
	pods := fake.NewClientset()
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: pods,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
		Scope: workloadLogScope("default", "apps", "v1", "gadget", "demo"),
	})
	require.Contains(t, resp.Error, "unsupported workload type")
}

func TestPodContainersPropagatesError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	_, err := service.PodContainers(context.Background(), "default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get pod")
}

func TestPodContainersSuccess(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)

	service := NewService(common.Dependencies{
		KubernetesClient: client,
	})

	containers, err := service.PodContainers(context.Background(), "default", "demo")
	require.NoError(t, err)
	require.Equal(t, []types.PodContainer{{Name: "init", IsInit: true}, {Name: "app"}}, containers)
}

func TestPodContainersRequiresTargetIdentity(t *testing.T) {
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	_, err := service.PodContainers(context.Background(), "", "demo-pod")
	require.EqualError(t, err, "namespace is required")

	_, err = service.PodContainers(context.Background(), "default", "")
	require.EqualError(t, err, "pod name is required")
}

func TestPodContainersIncludesEphemeral(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}},
			},
		},
	}
	client := fake.NewClientset(pod)

	service := NewService(common.Dependencies{
		KubernetesClient: client,
	})

	containers, err := service.PodContainers(context.Background(), "default", "demo")
	require.NoError(t, err)
	require.Equal(t, []types.PodContainer{{Name: "app"}, {Name: "debug-abc", IsEphemeral: true}}, containers)
}

// A workload's pods may name containers alike; each name and kind is listed
// once, and an init container stays distinct from a regular one of the same name.
func TestContainerLogsScopeContainersWorkloadReturnsUniqueContainers(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podOne := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "default", Labels: map[string]string{"app": "web"}},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init-a"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "sidecar"}},
		},
	}
	podTwo := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-2", Namespace: "default", Labels: map[string]string{"app": "web"}},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init-a"}, {Name: "sidecar"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "other"}},
		},
	}
	client := fake.NewClientset(deployment, podOne, podTwo)

	service := NewService(common.Dependencies{
		KubernetesClient: client,
	})

	containers, err := service.ContainerLogsScopeContainers(context.Background(), "cluster-a|default:apps/v1:deployment:web")
	require.NoError(t, err)
	require.Equal(t, []types.PodContainer{
		{Name: "app"},
		{Name: "init-a", IsInit: true},
		{Name: "other"},
		{Name: "sidecar", IsInit: true},
		{Name: "sidecar"},
	}, containers)
}

// Previous logs resolve a single pod with a plain GET, so they keep working for
// users who may read pods and their logs but not list or watch pods.
func TestFetchPreviousPodLogsWorksWithoutPodListOrWatch(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	})
	for _, verb := range []string{"list", "watch"} {
		client.PrependReactor(verb, "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(corev1.Resource("pods"), "", errors.New("denied"))
		})
	}
	var previous bool
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		previous = opts.Previous
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z crashed")), nil
	}
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: client})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
		Scope:    podLogScope("default", "demo"),
		Previous: true,
	})
	require.Empty(t, resp.Error)
	require.True(t, previous)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "crashed", resp.Entries[0].Line)
}

func TestFetchContainerLogsScopedPodUsesScopeNamespace(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod)
	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:01Z ok")), nil
	}

	service := NewService(common.Dependencies{
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
		Scope: "cluster-a|default:/v1:pod:demo",
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "ok", resp.Entries[0].Line)
}

func TestFetchContainerLogsParsesTimestamps(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)

	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		logs := "2024-01-01T00:00:00Z init line\napp line without ts"
		return io.NopCloser(strings.NewReader(logs)), nil
	}

	service := NewService(common.Dependencies{
		KubernetesClient: client,
	})

	entries, err := service.fetchContainerLogs(context.Background(), testContainerLogTarget(), testContainerLogRequest(50, false))
	require.NoError(t, err)
	require.Len(t, entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", entries[0].Timestamp)
	require.Equal(t, "init line", entries[0].Line)
	require.Empty(t, entries[1].Timestamp, "a first word that is not a timestamp stays in the line")
	require.Equal(t, "app line without ts", entries[1].Line)
}

// stubContainerLogStreams replaces the log reader for one test.
func stubContainerLogStreams(t *testing.T, stream func(ctx context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error)) {
	t.Helper()
	original := containerLogsStreamFunc
	t.Cleanup(func() { containerLogsStreamFunc = original })
	containerLogsStreamFunc = func(_ corev1client.PodInterface, ctx context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		return stream(ctx, podName, opts)
	}
}

func podWithContainers(names ...string) *corev1.Pod {
	containers := make([]corev1.Container, 0, len(names))
	for _, name := range names {
		containers = append(containers, corev1.Container{Name: name})
	}
	return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: containers}}
}

func fetchPreviousLogs(t *testing.T, pod *corev1.Pod) types.ContainerLogsFetchResponse {
	t.Helper()
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: fake.NewClientset(pod)})
	return service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", pod.Name), Previous: true})
}

// A container with no previous instance, or one still starting, is reported
// as unavailable rather than failing the request.
func TestFetchContainerLogsReportsUnavailableContainersAsIssues(t *testing.T) {
	for _, message := range []string{
		"container \"app\" in pod \"demo\" is waiting to start: ContainerCreating",
		"previous terminated container \"app\" in pod \"demo\" not found",
		"container app is not valid for pod demo",
	} {
		t.Run(message, func(t *testing.T) {
			stubContainerLogStreams(t, func(context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
				return nil, errors.New(message)
			})

			resp := fetchPreviousLogs(t, podWithContainers("app"))
			require.Empty(t, resp.Error)
			require.Empty(t, resp.Entries)
			require.Len(t, resp.Issues, 1)
			require.Equal(t, containerlogs.TargetIssue{
				Pod: "demo", Container: "app", State: containerlogs.IssueUnavailable, Reason: message,
			}, resp.Issues[0])
		})
	}
}

// One container failing must not hide the others' logs; the failure is listed.
func TestFetchContainerLogsKeepsOtherContainersWhenOneFails(t *testing.T) {
	stubContainerLogStreams(t, func(_ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		if opts.Container == "secret" {
			return nil, apierrors.NewForbidden(corev1.Resource("pods/log"), "demo", errors.New("denied"))
		}
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z ready")), nil
	})

	resp := fetchPreviousLogs(t, podWithContainers("app", "secret"))
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "app", resp.Entries[0].Container)
	require.Len(t, resp.Issues, 1)
	require.Equal(t, "secret", resp.Issues[0].Container)
	require.Equal(t, containerlogs.IssueForbidden, resp.Issues[0].State)
}

func TestFetchContainerLogsFailsWhenNoContainerCouldBeRead(t *testing.T) {
	stubContainerLogStreams(t, func(context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, errors.New("connection refused")
	})

	resp := fetchPreviousLogs(t, podWithContainers("app"))
	require.Contains(t, resp.Error, "connection refused")
	require.Len(t, resp.Issues, 1)
	require.Equal(t, containerlogs.IssueFailed, resp.Issues[0].State)
}

func TestFetchContainerLogsReadsContainersInParallelUpToTheLimit(t *testing.T) {
	var mu sync.Mutex
	active, peak := 0, 0
	stubContainerLogStreams(t, func(_ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		mu.Lock()
		active++
		peak = max(peak, active)
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		active--
		mu.Unlock()
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z " + opts.Container)), nil
	})

	resp := fetchPreviousLogs(t, podWithContainers("c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"))
	require.Len(t, resp.Entries, 8)
	require.Equal(t, config.ContainerLogsFetchParallelism, peak)
}

// A container whose log request never completes is abandoned after the
// per-container timeout, without holding back the other containers.
func TestFetchContainerLogsDoesNotWaitForAHangingContainer(t *testing.T) {
	original := containerLogsFetchTimeout
	containerLogsFetchTimeout = 100 * time.Millisecond
	t.Cleanup(func() { containerLogsFetchTimeout = original })
	stubContainerLogStreams(t, func(ctx context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		if opts.Container == "stuck" {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z ready")), nil
	})

	done := make(chan types.ContainerLogsFetchResponse, 1)
	go func() { done <- fetchPreviousLogs(t, podWithContainers("app", "stuck")) }()
	select {
	case resp := <-done:
		require.Len(t, resp.Entries, 1)
		require.Len(t, resp.Issues, 1)
		require.Equal(t, "stuck", resp.Issues[0].Container)
		require.Equal(t, containerlogs.IssueFailed, resp.Issues[0].State)
		require.Contains(t, resp.Issues[0].Reason, "100ms")
	case <-time.After(3 * time.Second):
		t.Fatal("a hanging container held back the fetch")
	}
}

func TestFetchContainerLogsStopsInFlightReadsWhenCancelled(t *testing.T) {
	started := make(chan struct{}, 2)
	stubContainerLogStreams(t, func(ctx context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		started <- struct{}{}
		<-ctx.Done()
		return nil, ctx.Err()
	})
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: fake.NewClientset(podWithContainers("a", "b"))})
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		defer close(done)
		service.FetchContainerLogs(ctx, types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo"), Previous: true})
	}()
	<-started
	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelling the caller did not stop the reads")
	}
}

func TestFetchContainerLogsUnexpectedErrorPropagates(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
	client := fake.NewClientset(pod)

	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, fmt.Errorf("forbidden")
	}

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	_, err := service.fetchContainerLogs(context.Background(), testContainerLogTarget(), testContainerLogRequest(10, false))
	require.Error(t, err)
	require.Contains(t, err.Error(), "forbidden")
}

func TestFetchContainerLogsAggregatesAndSortsEntries(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo-2", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod, pod2)

	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		switch podName {
		case "demo":
			if opts.Container == "init" {
				return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z init boot")), nil
			}
			return io.NopCloser(strings.NewReader("2024-01-01T00:00:01Z app ready")), nil
		case "demo-2":
			return io.NopCloser(strings.NewReader("2024-01-01T00:00:02Z other pod")), nil
		default:
			return nil, fmt.Errorf("unknown pod")
		}
	}

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", resp.Entries[0].Timestamp)
	require.Equal(t, "init", resp.Entries[0].Container)

	resp = service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo-2")})
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "other pod", resp.Entries[0].Line)
}

// Lines that share a timestamp (a stack trace written in one burst) must keep
// their order when containers' logs are merged.
func TestFetchContainerLogsKeepsSameTimestampBurstsInOrder(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}, {Name: "sidecar"}}},
	})
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		var lines []string
		for i := range 40 {
			if opts.Container == "app" {
				lines = append(lines, fmt.Sprintf("2024-01-01T00:00:01Z trace-%02d", i))
			} else {
				lines = append(lines, fmt.Sprintf("2024-01-01T00:00:00.%03dZ side-%02d", i*20, i))
			}
		}
		return io.NopCloser(strings.NewReader(strings.Join(lines, "\n"))), nil
	}
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: client})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Error)
	var trace []string
	for _, entry := range resp.Entries {
		if entry.Container == "app" {
			trace = append(trace, entry.Line)
		}
	}
	require.Len(t, trace, 40)
	for i, line := range trace {
		require.Equal(t, fmt.Sprintf("trace-%02d", i), line)
	}
}

func TestFetchContainerLogsRequiresClient(t *testing.T) {
	service := NewService(common.Dependencies{})
	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Contains(t, resp.Error, "kubernetes client not initialized")
}

type errReader struct{}

func (errReader) Read(b []byte) (int, error) { return 0, fmt.Errorf("read failure") }
func (errReader) Close() error               { return nil }

func TestFetchContainerLogsScannerError(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)

	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return errReader{}, nil
	}
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	_, err := service.fetchContainerLogs(context.Background(), testContainerLogTarget(), testContainerLogRequest(10, false))
	require.Error(t, err)
	require.Contains(t, err.Error(), "read failure")
}

func TestFetchContainerLogsHandlesOversizedLine(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)
	longLine := strings.Repeat("x", 80*1024)

	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z " + longLine)), nil
	}
	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	entries, err := service.fetchContainerLogs(context.Background(), testContainerLogTarget(), testContainerLogRequest(10, false))
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, longLine, entries[0].Line)
}

// A single oversized line used to fail the whole container's fetch.
func TestFetchContainerLogsKeepsOtherLinesAroundAnOversizedLine(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	client := fake.NewClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}})
	huge := strings.Repeat("x", 2*1024*1024)
	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(strings.Join([]string{
			"2024-01-01T00:00:01Z before",
			"2024-01-01T00:00:02Z " + huge,
			"2024-01-01T00:00:03Z after",
		}, "\n"))), nil
	}
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: client})

	entries, err := service.fetchContainerLogs(context.Background(), testContainerLogTarget(), testContainerLogRequest(10, false))
	require.NoError(t, err)
	require.Len(t, entries, 3)
	require.Equal(t, "before", entries[0].Line)
	require.Equal(t, "2024-01-01T00:00:02Z", entries[1].Timestamp)
	require.Less(t, len(entries[1].Line), len(huge))
	require.Equal(t, "after", entries[2].Line)
}

func TestFetchContainerLogsReturnsErrorWhenAllFetchesFail(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)
	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, fmt.Errorf("forbidden")
	}

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Entries)
	require.Contains(t, resp.Error, "failed to fetch logs")
	require.Contains(t, resp.Error, "forbidden")
}

func TestFetchContainerLogsAllowsPartialSuccessAcrossContainers(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		if opts.Container == "init" {
			return nil, fmt.Errorf("forbidden")
		}
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z app log")), nil
	}

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "app", resp.Entries[0].Container)
	require.Equal(t, "app log", resp.Entries[0].Line)
}

func TestFetchContainerLogsWarnsWhenTargetLimitExceeded(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	containerCount := containerlogs.DefaultPerScopeTargetLimit + 1
	containers := make([]corev1.Container, 0, containerCount)
	for i := 0; i < containerCount; i++ {
		containers = append(containers, corev1.Container{Name: fmt.Sprintf("c-%02d", i)})
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: containers},
	}
	client := fake.NewClientset(pod)
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s log", opts.Container))), nil
	}

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, containerlogs.DefaultPerScopeTargetLimit)
	require.Equal(t, []containerlogs.Warning{{
		Kind: containerlogs.WarningTargetLimit, Scope: containerlogs.LimitPerTab,
		Hidden: containerCount - containerlogs.DefaultPerScopeTargetLimit, Limit: containerlogs.DefaultPerScopeTargetLimit,
	}}, resp.Warnings)
}

func TestFetchContainerLogsSortsWhenTimestampMissing(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod)
	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("malformed line\n2024-01-01T00:00:01Z ok")), nil
	}

	service := NewService(common.Dependencies{
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Len(t, resp.Entries, 2)
	require.Equal(t, []string{"2024-01-01T00:00:01Z", ""}, []string{resp.Entries[0].Timestamp, resp.Entries[1].Timestamp})
	require.Equal(t, "malformed line", resp.Entries[1].Line)
}

func TestFetchContainerLogsUsesSharedCappedTargetSelection(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}

	objects := []runtime.Object{deployment}
	podCount := containerlogs.DefaultPerScopeTargetLimit + 1
	podObjects := make([]*corev1.Pod, 0, podCount)
	for i := 0; i < podCount; i++ {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("web-%02d", i),
				Namespace: "default",
				Labels:    map[string]string{"app": "web"},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "app"}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{{
					Type:   corev1.PodReady,
					Status: corev1.ConditionTrue,
				}},
			},
		}
		podObjects = append(podObjects, pod)
		objects = append(objects, pod)
	}

	client := fake.NewClientset(objects...)
	var requestedMu sync.Mutex
	requestedKeys := make([]string, 0, containerlogs.DefaultPerScopeTargetLimit)
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		requestedMu.Lock()
		defer requestedMu.Unlock()
		requestedKeys = append(requestedKeys, fmt.Sprintf("default/%s/%s", podName, opts.Container))
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s log", podName))), nil
	}

	service := NewService(common.Dependencies{
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
		Scope: workloadLogScope("default", "apps", "v1", "deployment", "web"),
	})
	require.Empty(t, resp.Error)

	expectedTargets, total := containerlogs.SelectTargets(
		podObjects,
		containerlogs.ScopeSelection{},
		containerlogs.DefaultPerScopeTargetLimit,
	)
	require.Equal(t, podCount, total)
	expectedKeys := make([]string, 0, len(expectedTargets))
	for _, target := range expectedTargets {
		expectedKeys = append(expectedKeys, fmt.Sprintf("%s/%s/%s", target.Namespace, target.PodName, target.Container.Name))
	}

	// Targets are read in parallel, so only the set of reads is fixed.
	require.ElementsMatch(t, expectedKeys, requestedKeys)
	require.Equal(t, []containerlogs.Warning{{
		Kind: containerlogs.WarningTargetLimit, Scope: containerlogs.LimitPerTab,
		Hidden: podCount - containerlogs.DefaultPerScopeTargetLimit, Limit: containerlogs.DefaultPerScopeTargetLimit,
	}}, resp.Warnings)
}

func TestFetchContainerLogsAppliesSelectedFiltersBeforeTargetLimit(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	pods := []runtime.Object{deployment}
	for _, podName := range []string{"web-1", "web-2", "web-3"} {
		pods = append(pods, &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      podName,
				Namespace: "default",
				Labels:    map[string]string{"app": "web"},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "app"}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{{
					Type:   corev1.PodReady,
					Status: corev1.ConditionTrue,
				}},
			},
		})
	}

	client := fake.NewClientset(pods...)
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, podName string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s log", podName))), nil
	}

	service := NewService(common.Dependencies{
		Logger:                           applog.Noop,
		KubernetesClient:                 client,
		ContainerLogsPerScopeTargetLimit: 1,
	})

	resp := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
		Scope:           workloadLogScope("default", "apps", "v1", "deployment", "web"),
		SelectedFilters: []string{"pod:web-3"},
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "web-3", resp.Entries[0].Pod)
	require.Empty(t, resp.Warnings)
}
