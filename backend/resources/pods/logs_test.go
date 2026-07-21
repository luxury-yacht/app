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
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
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

func TestFetchContainerLogsRequiresScopeWhenRequestEmpty(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{})
	require.Equal(t, "container logs scope is required", resp.Error)
}

func TestFetchContainerLogsRequiresScope(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	for _, tc := range []struct {
		name string
		req  types.ContainerLogsFetchRequest
	}{
		{name: "container option without scope", req: types.ContainerLogsFetchRequest{Container: "app"}},
		{name: "filter option without scope", req: types.ContainerLogsFetchRequest{SelectedFilters: []string{"pod:demo"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := service.FetchContainerLogs(tc.req)
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	response := service.FetchContainerLogs(types.ContainerLogsFetchRequest{
		Scope:     podLogScope("default", "demo"),
		MatchNone: true,
	})

	require.Empty(t, response.Error)
	require.Empty(t, response.Entries)
}

func TestFetchContainerLogsUnsupportedWorkload(t *testing.T) {
	pods := fake.NewClientset()
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: pods,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	_, err := service.PodContainers("default", "demo")
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
		Context:          context.Background(),
		KubernetesClient: client,
	})

	containers, err := service.PodContainers("default", "demo")
	require.NoError(t, err)
	require.Equal(t, []string{"init (init)", "app"}, containers)
}

func TestPodContainersRequiresTargetIdentity(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	_, err := service.PodContainers("", "demo-pod")
	require.EqualError(t, err, "namespace is required")

	_, err = service.PodContainers("default", "")
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
		Context:          context.Background(),
		KubernetesClient: client,
	})

	containers, err := service.PodContainers("default", "demo")
	require.NoError(t, err)
	require.Equal(t, []string{"app", "debug-abc (debug)"}, containers)
}

func TestContainerLogsScopeContainersWorkloadReturnsUniqueDisplayNames(t *testing.T) {
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
			InitContainers: []corev1.Container{{Name: "init-a"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "other"}},
		},
	}
	client := fake.NewClientset(deployment, podOne, podTwo)

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	containers, err := service.ContainerLogsScopeContainers("cluster-a|default:apps/v1:deployment:web")
	require.NoError(t, err)
	require.Equal(t, []string{"app", "init-a (init)", "other", "sidecar"}, containers)
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
		Context:          context.Background(),
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{
		Scope: "cluster-a|default:/v1:pod:demo",
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "ok", resp.Entries[0].Line)
}

func TestFetchContainerLogsAppliesIncludeExcludeFilters(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod)
	containerLogsStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		logs := strings.Join([]string{
			"2024-01-01T00:00:01Z info starting",
			"2024-01-01T00:00:02Z warn should-keep",
			"2024-01-01T00:00:03Z warn healthcheck",
		}, "\n")
		return io.NopCloser(strings.NewReader(logs)), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{
		Scope:   podLogScope("default", "demo"),
		Include: "warn",
		Exclude: "healthcheck",
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "warn should-keep", resp.Entries[0].Line)
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
		Context:          context.Background(),
		KubernetesClient: client,
	})

	entries, err := service.fetchContainerLogs("default", "demo", "app", false, false, 50, false, 0, containerlogs.LineFilter{})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", entries[0].Timestamp)
	require.Equal(t, "init line", entries[0].Line)
	require.Equal(t, "line without ts", entries[1].Line)
}

func TestFetchContainerLogsSwallowsCommonErrors(t *testing.T) {
	testCases := []struct {
		name     string
		errorMsg string
	}{
		{"waiting to start", "waiting to start: container not found"},
		{"container not found", "container not found"},
		{"previous terminated not found", "previous terminated container \"app\" in pod not found"},
		{"not valid for pod", "container app is not valid for pod demo"},
		{"ContainerCreating", "container \"app\" in pod \"demo\" is ContainerCreating"},
		{"PodInitializing", "container \"app\" in pod \"demo\" is PodInitializing"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
				containerLogsStreamFunc = orig
			}(containerLogsStreamFunc)

			pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
			client := fake.NewClientset(pod)

			containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
				return nil, errors.New(tc.errorMsg)
			}

			service := NewService(common.Dependencies{
				Context:          context.Background(),
				Logger:           applog.Noop,
				KubernetesClient: client,
			})

			entries, err := service.fetchContainerLogs("default", "demo", "app", false, false, 10, true, 5, containerlogs.LineFilter{})
			require.NoError(t, err)
			require.Empty(t, entries)
		})
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	_, err := service.fetchContainerLogs("default", "demo", "app", false, false, 10, false, 0, containerlogs.LineFilter{})
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", resp.Entries[0].Timestamp)
	require.Equal(t, "init", resp.Entries[0].Container)

	resp = service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo-2")})
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "other pod", resp.Entries[0].Line)
}

func TestFetchContainerLogsRequiresClient(t *testing.T) {
	service := NewService(common.Dependencies{
		Context: context.Background(),
	})
	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	_, err := service.fetchContainerLogs("default", "demo", "app", false, false, 10, false, 0, containerlogs.LineFilter{})
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	entries, err := service.fetchContainerLogs("default", "demo", "app", false, false, 10, false, 0, containerlogs.LineFilter{})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, longLine, entries[0].Line)
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, containerlogs.DefaultPerScopeTargetLimit)
	require.Len(t, resp.Warnings, 1)
	require.Contains(
		t,
		resp.Warnings[0],
		fmt.Sprintf(
			"Logs are hidden for %d containers because the per-tab limit of %d was reached.",
			containerCount-containerlogs.DefaultPerScopeTargetLimit,
			containerlogs.DefaultPerScopeTargetLimit,
		),
	)
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
		Context:          context.Background(),
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{Scope: podLogScope("default", "demo")})
	require.Len(t, resp.Entries, 2)
	require.Equal(t, []string{"2024-01-01T00:00:01Z", "malformed"}, []string{resp.Entries[0].Timestamp, resp.Entries[1].Timestamp})
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
	requestedKeys := make([]string, 0, containerlogs.DefaultPerScopeTargetLimit)
	containerLogsStreamFunc = func(_ corev1client.PodInterface, _ context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		requestedKeys = append(requestedKeys, fmt.Sprintf("default/%s/%s", podName, opts.Container))
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s log", podName))), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{
		Scope: workloadLogScope("default", "apps", "v1", "deployment", "web"),
	})
	require.Empty(t, resp.Error)

	expectedTargets, total := containerlogs.SelectTargets(
		podObjects,
		containerlogs.DefaultContainerSelection(""),
		containerlogs.DefaultPerScopeTargetLimit,
	)
	require.Equal(t, podCount, total)
	expectedKeys := make([]string, 0, len(expectedTargets))
	for _, target := range expectedTargets {
		expectedKeys = append(expectedKeys, fmt.Sprintf("%s/%s/%s", target.Namespace, target.PodName, target.Container.Name))
	}

	require.Equal(t, expectedKeys, requestedKeys)
	require.Len(t, resp.Warnings, 1)
	require.Contains(
		t,
		resp.Warnings[0],
		fmt.Sprintf(
			"Logs are hidden for %d containers because the per-tab limit of %d was reached.",
			podCount-containerlogs.DefaultPerScopeTargetLimit,
			containerlogs.DefaultPerScopeTargetLimit,
		),
	)
}

func TestFetchContainerLogsAppliesSelectedFiltersBeforeTargetLimit(t *testing.T) {
	defer func(orig int) {
		containerlogs.SetPerScopeTargetLimit(orig)
	}(containerlogs.GetPerScopeTargetLimit())
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		containerLogsStreamFunc = orig
	}(containerLogsStreamFunc)

	containerlogs.SetPerScopeTargetLimit(1)

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
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	})

	resp := service.FetchContainerLogs(types.ContainerLogsFetchRequest{
		Scope:           workloadLogScope("default", "apps", "v1", "deployment", "web"),
		SelectedFilters: []string{"pod:web-3"},
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "web-3", resp.Entries[0].Pod)
	require.Empty(t, resp.Warnings)
}
