/*
 * backend/resources/pods/logs_test.go
 *
 * Tests for Pod log retrieval and follow helpers.
 * - Covers Pod log retrieval and follow helpers behavior and edge cases.
 */

package pods

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/podlogs"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestLogFetcherRequiresNamespace(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: fake.NewClientset(),
	})

	resp := service.LogFetcher(types.LogFetchRequest{})
	require.Equal(t, "namespace is required", resp.Error)
}

func TestLogFetcherUnsupportedWorkload(t *testing.T) {
	pods := fake.NewClientset()
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: pods,
	})

	resp := service.LogFetcher(types.LogFetchRequest{
		Namespace:    "default",
		WorkloadKind: "gadget",
		WorkloadName: "demo",
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
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := service.PodContainers("default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get pod")
}

func TestPodsBySelectorPropagatesError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("selector failure")
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	_, err := service.podsBySelector("default", "app=demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "selector failure")
}

func TestPodsBySelectorReturnsMatches(t *testing.T) {
	podA := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default", Labels: map[string]string{"app": "demo"}}}
	podB := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "default", Labels: map[string]string{"app": "other"}}}
	client := fake.NewClientset(podA, podB)

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods, err := service.podsBySelector("default", "app=demo")
	require.NoError(t, err)
	require.Equal(t, []string{"pod-a"}, pods)
}

func TestPodsForCronJobAggregatesPods(t *testing.T) {
	owner := metav1.OwnerReference{Kind: "CronJob", Name: "nightly", Controller: ptrBool(true)}
	jobOne := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "nightly-1", Namespace: "default", OwnerReferences: []metav1.OwnerReference{owner}},
	}
	jobTwo := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "nightly-2", Namespace: "default", OwnerReferences: []metav1.OwnerReference{owner}},
	}

	podA := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default", Labels: map[string]string{"job-name": "nightly-1"}}}
	podB := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "default", Labels: map[string]string{"job-name": "nightly-2"}}}

	client := fake.NewClientset(jobOne, jobTwo, podA, podB)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods, err := service.podsForCronJob("default", "nightly")
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"pod-a", "pod-b"}, pods)
}

func TestPodsForCronJobContinuesOnPodListError(t *testing.T) {
	owner := metav1.OwnerReference{Kind: "CronJob", Name: "nightly", Controller: ptrBool(true)}
	jobOne := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "nightly-1", Namespace: "default", OwnerReferences: []metav1.OwnerReference{owner}}}
	jobTwo := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "nightly-2", Namespace: "default", OwnerReferences: []metav1.OwnerReference{owner}}}
	podB := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "default", Labels: map[string]string{"job-name": "nightly-2"}}}

	client := fake.NewClientset(jobOne, jobTwo, podB)
	var calls int
	client.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		calls++
		if calls == 1 {
			return true, nil, fmt.Errorf("pods unavailable")
		}
		return false, nil, nil
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	pods, err := service.podsForCronJob("default", "nightly")
	require.NoError(t, err)
	require.Equal(t, []string{"pod-b"}, pods)
}

func TestFetchPodLogsPropagatesGetError(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := service.fetchPodLogs("default", "pod", "", 10, false, 0, podlogs.LineFilter{})
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

func TestResolveTargetPodsDeployment(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-pod", Namespace: "default", Labels: map[string]string{"app": "web"}}}
	client := fake.NewClientset(deployment, pod)

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods, err := service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", WorkloadKind: "deployment", WorkloadName: "web"})
	require.NoError(t, err)
	require.Equal(t, []string{"web-pod"}, pods)
}

func TestResolveTargetPodsAppliesPodFilter(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podOne := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "default", Labels: map[string]string{"app": "web"}},
	}
	podTwo := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-2", Namespace: "default", Labels: map[string]string{"app": "web"}},
	}
	client := fake.NewClientset(deployment, podOne, podTwo)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods, err := service.resolveTargetPods(types.LogFetchRequest{
		Namespace:    "default",
		WorkloadKind: "deployment",
		WorkloadName: "web",
		PodFilter:    "web-2",
	})
	require.NoError(t, err)
	require.Equal(t, []string{"web-2"}, pods)
}

func TestResolveTargetPodsAppliesPodNameRegexFilters(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podOne := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-api-1", Namespace: "default", Labels: map[string]string{"app": "web"}},
	}
	podTwo := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-worker-1", Namespace: "default", Labels: map[string]string{"app": "web"}},
	}
	podThree := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-api-canary", Namespace: "default", Labels: map[string]string{"app": "web"}},
	}
	client := fake.NewClientset(deployment, podOne, podTwo, podThree)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods, err := service.resolveTargetPods(types.LogFetchRequest{
		Namespace:    "default",
		WorkloadKind: "deployment",
		WorkloadName: "web",
		PodInclude:   "api",
		PodExclude:   "canary$",
	})
	require.NoError(t, err)
	require.Equal(t, []string{"web-api-1"}, pods)
}

func TestResolveTargetPodsCronJob(t *testing.T) {
	owner := metav1.OwnerReference{Kind: "CronJob", Name: "nightly", Controller: ptrBool(true)}
	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "nightly-1", Namespace: "default", OwnerReferences: []metav1.OwnerReference{owner}}}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "nightly-pod", Namespace: "default", Labels: map[string]string{"job-name": "nightly-1"}}}
	client := fake.NewClientset(job, pod)

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	pods, err := service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", WorkloadKind: "cronjob", WorkloadName: "nightly"})
	require.NoError(t, err)
	require.Equal(t, []string{"nightly-pod"}, pods)
}

func TestResolveTargetPodsScopedGVKDeployment(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-pod", Namespace: "default", Labels: map[string]string{"app": "web"}}}
	client := fake.NewClientset(deployment, pod)

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods, err := service.resolveTargetPods(types.LogFetchRequest{
		Scope: "cluster-a|default:apps/v1:deployment:web",
	})
	require.NoError(t, err)
	require.Equal(t, []string{"web-pod"}, pods)
}

func TestLogFetcherScopedPodUsesScopeNamespace(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod)
	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:01Z ok")), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{
		Scope: "cluster-a|default:/v1:pod:demo",
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "ok", resp.Entries[0].Line)
}

func TestLogFetcherAppliesIncludeExcludeFilters(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod)
	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
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

	resp := service.LogFetcher(types.LogFetchRequest{
		Namespace: "default",
		PodName:   "demo",
		Include:   "warn",
		Exclude:   "healthcheck",
	})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "warn should-keep", resp.Entries[0].Line)
}

func TestLogFetcherAggregatesWorkloadPods(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
		Spec:       appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}}},
	}
	podA := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", Labels: map[string]string{"app": "api"}}}
	podB := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-1", Namespace: "default", Labels: map[string]string{"app": "api"}}}

	client := fake.NewClientset(deployment, podA, podB)

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{
		Namespace:    "default",
		WorkloadKind: "deployment",
		WorkloadName: "api",
	})
	require.Empty(t, resp.Error)
	sort.Slice(resp.Entries, func(i, j int) bool { return resp.Entries[i].Pod < resp.Entries[j].Pod })
	require.Len(t, resp.Entries, 0)
	require.NotPanics(t, func() { service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", PodName: "api-0"}) })
}

func TestFetchContainerLogsParsesTimestamps(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)

	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		logs := "2024-01-01T00:00:00Z init line\napp line without ts"
		return io.NopCloser(strings.NewReader(logs)), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	entries, err := service.fetchContainerLogs("default", "demo", "app", false, 50, false, 0, podlogs.LineFilter{})
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
				logStreamFunc = orig
			}(logStreamFunc)

			pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
			client := fake.NewClientset(pod)

			logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
				return nil, errors.New(tc.errorMsg)
			}

			service := NewService(common.Dependencies{
				Context:          context.Background(),
				Logger:           testsupport.NoopLogger{},
				KubernetesClient: client,
			})

			entries, err := service.fetchContainerLogs("default", "demo", "app", false, 10, true, 5, podlogs.LineFilter{})
			require.NoError(t, err)
			require.Empty(t, entries)
		})
	}
}

func TestFetchContainerLogsUnexpectedErrorPropagates(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
	client := fake.NewClientset(pod)

	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, fmt.Errorf("forbidden")
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := service.fetchContainerLogs("default", "demo", "app", false, 10, false, 0, podlogs.LineFilter{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "forbidden")
}

func TestLogFetcherAggregatesAndSortsEntries(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

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

	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
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
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", resp.Entries[0].Timestamp)
	require.Equal(t, "init", resp.Entries[0].Container)

	resp = service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo-2"})
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "other pod", resp.Entries[0].Line)
}

func TestResolveTargetPodsOtherWorkloads(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Name: "rs", Namespace: "default"},
		Spec:       appsv1.ReplicaSetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "rs"}}},
	}
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: "ds", Namespace: "default"},
		Spec:       appsv1.DaemonSetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "ds"}}},
	}
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "sts", Namespace: "default"},
		Spec:       appsv1.StatefulSetSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "sts"}}},
	}
	rsPod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "rs-pod", Namespace: "default", Labels: map[string]string{"app": "rs"}}}
	dsPod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "ds-pod", Namespace: "default", Labels: map[string]string{"app": "ds"}}}
	stsPod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "sts-0", Namespace: "default", Labels: map[string]string{"app": "sts"}}}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "job", Namespace: "default", Labels: map[string]string{"job-name": "job"}},
		Spec:       batchv1.JobSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"job-name": "job"}}},
	}
	jobPod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "job-pod", Namespace: "default", Labels: map[string]string{"job-name": "job"}}}

	client := fake.NewClientset(rs, ds, sts, rsPod, dsPod, stsPod, job, jobPod)
	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z log")), nil
	}
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	rsPods, err := service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", WorkloadKind: "replicaset", WorkloadName: "rs"})
	require.NoError(t, err)
	require.Equal(t, []string{"rs-pod"}, rsPods)

	dsPods, err := service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", WorkloadKind: "daemonset", WorkloadName: "ds"})
	require.NoError(t, err)
	require.Equal(t, []string{"ds-pod"}, dsPods)

	stsPods, err := service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", WorkloadKind: "statefulset", WorkloadName: "sts"})
	require.NoError(t, err)
	require.Equal(t, []string{"sts-0"}, stsPods)

	jobPods, err := service.resolveTargetPods(types.LogFetchRequest{Namespace: "default", WorkloadKind: "job", WorkloadName: "job"})
	require.NoError(t, err)
	require.Equal(t, []string{"job-pod"}, jobPods)
}

func TestLogFetcherRequiresClient(t *testing.T) {
	service := NewService(common.Dependencies{
		Context: context.Background(),
	})
	resp := service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Contains(t, resp.Error, "kubernetes client not initialized")
}

type errReader struct{}

func (errReader) Read(b []byte) (int, error) { return 0, fmt.Errorf("read failure") }
func (errReader) Close() error               { return nil }

func TestFetchContainerLogsScannerError(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)

	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return errReader{}, nil
	}
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := service.fetchContainerLogs("default", "demo", "app", false, 10, false, 0, podlogs.LineFilter{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "read failure")
}

func TestFetchContainerLogsHandlesOversizedLine(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)
	longLine := strings.Repeat("x", 80*1024)

	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z " + longLine)), nil
	}
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	entries, err := service.fetchContainerLogs("default", "demo", "app", false, 10, false, 0, podlogs.LineFilter{})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, longLine, entries[0].Line)
}

func TestFetchPodLogsSpecificContainer(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)
	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		require.Equal(t, "app", opts.Container)
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z only app")), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	entries, err := service.fetchPodLogs("default", "demo", "app", 100, false, 0, podlogs.LineFilter{})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "only app", entries[0].Line)
	require.False(t, entries[0].IsInit)
}

func TestFetchPodLogsIncludesEphemeralInAllContainers(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}},
			},
		},
	}
	client := fake.NewClientset(pod)
	requestedContainers := make([]string, 0, 3)
	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		requestedContainers = append(requestedContainers, opts.Container)
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s line", opts.Container))), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	entries, err := service.fetchPodLogs("default", "demo", "all", 100, false, 0, podlogs.LineFilter{})
	require.NoError(t, err)
	require.Len(t, entries, 3)
	require.Equal(t, []string{"init", "app", "debug-abc"}, requestedContainers)
	require.Equal(t, []string{"init", "app", "debug-abc"}, []string{entries[0].Container, entries[1].Container, entries[2].Container})
	require.Equal(t, "debug-abc line", entries[2].Line)
}

func TestFetchPodLogsMatchesSharedContainerEnumeration(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}},
			},
		},
	}
	client := fake.NewClientset(pod)
	requestedContainers := make([]string, 0, 3)
	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		requestedContainers = append(requestedContainers, opts.Container)
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s line", opts.Container))), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := service.fetchPodLogs("default", "demo", "all", 100, false, 0, podlogs.LineFilter{})
	require.NoError(t, err)

	sharedContainers := podlogs.EnumerateContainers(pod, "all")
	expectedNames := make([]string, 0, len(sharedContainers))
	for _, containerRef := range sharedContainers {
		expectedNames = append(expectedNames, containerRef.Name)
	}

	require.Equal(t, expectedNames, requestedContainers)
}

func TestLogFetcherReturnsErrorWhenAllFetchesFail(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)
	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, fmt.Errorf("forbidden")
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Empty(t, resp.Entries)
	require.Contains(t, resp.Error, "failed to fetch logs")
	require.Contains(t, resp.Error, "forbidden")
}

func TestLogFetcherAllowsPartialSuccessAcrossContainers(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)
	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		if opts.Container == "init" {
			return nil, fmt.Errorf("forbidden")
		}
		return io.NopCloser(strings.NewReader("2024-01-01T00:00:00Z app log")), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 1)
	require.Equal(t, "app", resp.Entries[0].Container)
	require.Equal(t, "app log", resp.Entries[0].Line)
}

func TestLogFetcherWarnsWhenTargetLimitExceeded(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	containers := make([]corev1.Container, 0, 25)
	for i := 0; i < 25; i++ {
		containers = append(containers, corev1.Container{Name: fmt.Sprintf("c-%02d", i)})
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: containers},
	}
	client := fake.NewClientset(pod)
	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s log", opts.Container))), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, podlogs.DefaultPerScopeTargetLimit)
	require.Len(t, resp.Warnings, 1)
	require.Contains(t, resp.Warnings[0], "24 of 25")
}

func TestLogFetcherUsesSharedCappedTargetSelection(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}

	objects := []runtime.Object{deployment}
	podObjects := make([]*corev1.Pod, 0, 25)
	for i := 0; i < 25; i++ {
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
	requestedKeys := make([]string, 0, podlogs.DefaultPerScopeTargetLimit)
	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, podName string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		requestedKeys = append(requestedKeys, fmt.Sprintf("default/%s/%s", podName, opts.Container))
		return io.NopCloser(strings.NewReader(fmt.Sprintf("2024-01-01T00:00:00Z %s log", podName))), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{
		Namespace:    "default",
		WorkloadKind: "deployment",
		WorkloadName: "web",
	})
	require.Empty(t, resp.Error)

	expectedTargets, total := podlogs.SelectTargets(
		podObjects,
		podlogs.DefaultContainerSelection(""),
		podlogs.DefaultPerScopeTargetLimit,
	)
	require.Equal(t, 25, total)
	expectedKeys := make([]string, 0, len(expectedTargets))
	for _, target := range expectedTargets {
		expectedKeys = append(expectedKeys, target.Key())
	}

	require.Equal(t, expectedKeys, requestedKeys)
	require.Len(t, resp.Warnings, 1)
	require.Contains(t, resp.Warnings[0], "24 of 25")
}

func TestLogFetcherSortsWhenTimestampMissing(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	client := fake.NewClientset(pod)
	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("malformed line\n2024-01-01T00:00:01Z ok")), nil
	}

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	resp := service.LogFetcher(types.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Len(t, resp.Entries, 2)
	require.Equal(t, []string{"2024-01-01T00:00:01Z", "malformed"}, []string{resp.Entries[0].Timestamp, resp.Entries[1].Timestamp})
}
