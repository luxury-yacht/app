package pods

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"testing"

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
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

func TestLogFetcherRequiresNamespace(t *testing.T) {
	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: fake.NewClientset(),
	}})

	resp := service.LogFetcher(restypes.LogFetchRequest{})
	require.Equal(t, "namespace is required", resp.Error)
}

func TestLogFetcherUnsupportedWorkload(t *testing.T) {
	pods := fake.NewClientset()
	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: pods,
	}})

	resp := service.LogFetcher(restypes.LogFetchRequest{
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	_, err := service.PodContainers("default", "demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get pod")
}

func TestPodsBySelectorPropagatesError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("selector failure")
	})

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

	_, err := service.podsBySelector("default", "app=demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "selector failure")
}

func TestPodsBySelectorReturnsMatches(t *testing.T) {
	podA := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default", Labels: map[string]string{"app": "demo"}}}
	podB := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "default", Labels: map[string]string{"app": "other"}}}
	client := fake.NewClientset(podA, podB)

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

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
	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	pods, err := service.podsForCronJob("default", "nightly")
	require.NoError(t, err)
	require.Equal(t, []string{"pod-b"}, pods)
}

func TestFetchPodLogsPropagatesGetError(t *testing.T) {
	client := fake.NewClientset()
	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	_, err := service.fetchPodLogs("default", "pod", "", 10, false, 0)
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

	containers, err := service.PodContainers("default", "demo")
	require.NoError(t, err)
	require.Equal(t, []string{"init (init)", "app"}, containers)
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

	pods, err := service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", WorkloadKind: "deployment", WorkloadName: "web"})
	require.NoError(t, err)
	require.Equal(t, []string{"web-pod"}, pods)
}

func TestResolveTargetPodsCronJob(t *testing.T) {
	owner := metav1.OwnerReference{Kind: "CronJob", Name: "nightly", Controller: ptrBool(true)}
	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "nightly-1", Namespace: "default", OwnerReferences: []metav1.OwnerReference{owner}}}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "nightly-pod", Namespace: "default", Labels: map[string]string{"job-name": "nightly-1"}}}
	client := fake.NewClientset(job, pod)

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	pods, err := service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", WorkloadKind: "cronjob", WorkloadName: "nightly"})
	require.NoError(t, err)
	require.Equal(t, []string{"nightly-pod"}, pods)
}

func TestLogFetcherAggregatesWorkloadPods(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
		Spec:       appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}}},
	}
	podA := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", Labels: map[string]string{"app": "api"}}}
	podB := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-1", Namespace: "default", Labels: map[string]string{"app": "api"}}}

	client := fake.NewClientset(deployment, podA, podB)

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	resp := service.LogFetcher(restypes.LogFetchRequest{
		Namespace:    "default",
		WorkloadKind: "deployment",
		WorkloadName: "api",
	})
	require.Empty(t, resp.Error)
	sort.Slice(resp.Entries, func(i, j int) bool { return resp.Entries[i].Pod < resp.Entries[j].Pod })
	require.Len(t, resp.Entries, 0)
	require.NotPanics(t, func() { service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", PodName: "api-0"}) })
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

	entries, err := service.fetchContainerLogs("default", "demo", "app", false, 50, false, 0)
	require.NoError(t, err)
	require.Len(t, entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", entries[0].Timestamp)
	require.Equal(t, "init line", entries[0].Line)
	require.Equal(t, "line without ts", entries[1].Line)
}

func TestFetchContainerLogsSwallowsCommonErrors(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}}
	client := fake.NewClientset(pod)

	logStreamFunc = func(_ corev1client.PodInterface, _ context.Context, _ string, _ *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, fmt.Errorf("waiting to start: container not found")
	}

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	entries, err := service.fetchContainerLogs("default", "demo", "app", false, 10, true, 5)
	require.NoError(t, err)
	require.Empty(t, entries)
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	_, err := service.fetchContainerLogs("default", "demo", "app", false, 10, false, 0)
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	resp := service.LogFetcher(restypes.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Empty(t, resp.Error)
	require.Len(t, resp.Entries, 2)
	require.Equal(t, "2024-01-01T00:00:00Z", resp.Entries[0].Timestamp)
	require.Equal(t, "init", resp.Entries[0].Container)

	resp = service.LogFetcher(restypes.LogFetchRequest{Namespace: "default", PodName: "demo-2"})
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
	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	rsPods, err := service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", WorkloadKind: "replicaset", WorkloadName: "rs"})
	require.NoError(t, err)
	require.Equal(t, []string{"rs-pod"}, rsPods)

	dsPods, err := service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", WorkloadKind: "daemonset", WorkloadName: "ds"})
	require.NoError(t, err)
	require.Equal(t, []string{"ds-pod"}, dsPods)

	stsPods, err := service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", WorkloadKind: "statefulset", WorkloadName: "sts"})
	require.NoError(t, err)
	require.Equal(t, []string{"sts-0"}, stsPods)

	jobPods, err := service.resolveTargetPods(restypes.LogFetchRequest{Namespace: "default", WorkloadKind: "job", WorkloadName: "job"})
	require.NoError(t, err)
	require.Equal(t, []string{"job-pod"}, jobPods)
}

func TestLogFetcherRequiresClient(t *testing.T) {
	service := NewService(Dependencies{Common: common.Dependencies{
		Context: context.Background(),
	}})
	resp := service.LogFetcher(restypes.LogFetchRequest{Namespace: "default", PodName: "demo"})
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
	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	_, err := service.fetchContainerLogs("default", "demo", "app", false, 10, false, 0)
	require.Error(t, err)
	require.Contains(t, err.Error(), "read failure")
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	entries, err := service.fetchPodLogs("default", "demo", "app", 100, false, 0)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "only app", entries[0].Line)
	require.False(t, entries[0].IsInit)
}

func TestLogFetcherHandlesFetchErrors(t *testing.T) {
	defer func(orig func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error)) {
		logStreamFunc = orig
	}(logStreamFunc)

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}
	client := fake.NewClientset(pod)
	logStreamFunc = func(corev1client.PodInterface, context.Context, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, fmt.Errorf("forbidden")
	}

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		Logger:           noopLogger{},
		KubernetesClient: client,
	}})

	resp := service.LogFetcher(restypes.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Empty(t, resp.Entries)
	require.Empty(t, resp.Error)
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

	service := NewService(Dependencies{Common: common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	}})

	resp := service.LogFetcher(restypes.LogFetchRequest{Namespace: "default", PodName: "demo"})
	require.Len(t, resp.Entries, 2)
	require.Equal(t, []string{"2024-01-01T00:00:01Z", "malformed"}, []string{resp.Entries[0].Timestamp, resp.Entries[1].Timestamp})
}
