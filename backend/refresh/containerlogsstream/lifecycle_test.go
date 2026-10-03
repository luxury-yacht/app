package containerlogsstream

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// runHarness drives one session's target lifecycle with scripted log
// responses and pod watch events.
type runHarness struct {
	t        *testing.T
	client   *fake.Clientset
	logs     *logPods
	errs     chan error
	entries  chan Entry
	cancel   context.CancelFunc
	done     chan struct{}
	mu       sync.Mutex
	watchers []*fakeWatch
}

type runSetup struct {
	opts    Options
	initial []*corev1.Pod
	objects []runtime.Object
	respond func(*corev1.PodLogOptions) logResponse
	limiter *TargetSession
	// prepare adjusts the fake API server before the session resolves.
	prepare func(*fake.Clientset)
	// afterResolve changes the fake API server after the session resolved its
	// pods and before its informer first lists them.
	afterResolve func(*fake.Clientset)
}

func startRun(t *testing.T, opts Options, initial []*corev1.Pod, respond func(*corev1.PodLogOptions) logResponse) *runHarness {
	return startRunWith(t, runSetup{opts: opts, initial: initial, respond: respond})
}

func startRunWith(t *testing.T, setup runSetup) *runHarness {
	t.Helper()
	objects := append([]runtime.Object(nil), setup.objects...)
	for _, pod := range setup.initial {
		objects = append(objects, pod.DeepCopy())
	}
	baseClient := fake.NewClientset(objects...)
	harness := &runHarness{t: t, client: baseClient, errs: make(chan error, 8), entries: make(chan Entry, 64), done: make(chan struct{})}
	// Every watch the informer opens gets its own scripted watcher, so a test
	// can end one and observe the informer's re-list and re-watch.
	baseClient.PrependWatchReactor("pods", func(k8stesting.Action) (bool, watch.Interface, error) {
		watcher := &fakeWatch{ch: make(chan watch.Event, 16)}
		harness.mu.Lock()
		harness.watchers = append(harness.watchers, watcher)
		harness.mu.Unlock()
		return true, watcher, nil
	})
	if setup.prepare != nil {
		setup.prepare(baseClient)
	}
	harness.logs = newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", nil)
	harness.logs.responder = setup.respond
	client := &stubClient{Clientset: baseClient, core: &logCore{
		CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": harness.logs},
	}}
	streamer := NewStreamer(client, applog.Noop, nil)
	ctx, cancel := context.WithCancel(context.Background())
	harness.cancel = cancel
	resolution, err := streamer.resolve(ctx, setup.opts)
	require.NoError(t, err)
	if setup.afterResolve != nil {
		setup.afterResolve(baseClient)
	}
	go func() {
		defer close(harness.done)
		streamer.run(ctx, resolution.Pods, resolution.Watch, containerLogRunConfig{
			opts: setup.opts, limiterSession: setup.limiter, sink: channelSink(harness.entries),
			warnings: newWarningUpdates(), fatal: harness.errs,
		})
	}()
	t.Cleanup(harness.stop)
	return harness
}

func (h *runHarness) stop() {
	h.cancel()
	select {
	case <-h.done:
	case <-time.After(3 * time.Second):
		h.t.Error("session did not stop")
	}
}

// watcher returns the informer's current pod watch once it is open.
func (h *runHarness) watcher(opened int) *fakeWatch {
	h.t.Helper()
	var current *fakeWatch
	require.Eventually(h.t, func() bool {
		h.mu.Lock()
		defer h.mu.Unlock()
		if len(h.watchers) < opened {
			return false
		}
		current = h.watchers[len(h.watchers)-1]
		return true
	}, 5*time.Second, 5*time.Millisecond, "pod watch %d never opened", opened)
	return current
}

func (h *runHarness) send(eventType watch.EventType, pod *corev1.Pod) {
	h.watcher(1).ch <- watch.Event{Type: eventType, Object: pod.DeepCopy()}
}

func (h *runHarness) expectLine(line string) {
	h.t.Helper()
	deadline := time.After(4 * time.Second)
	for {
		select {
		case entry := <-h.entries:
			if entry.Line == line {
				return
			}
		case <-deadline:
			h.t.Fatalf("line %q never arrived", line)
		}
	}
}

func testPod(name string, spec corev1.PodSpec, status corev1.PodStatus) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: name, Labels: map[string]string{"job-name": "migrate"}},
		Spec:       spec,
		Status:     status,
	}
}

func runningStatus(name, id string) corev1.ContainerStatus {
	return corev1.ContainerStatus{Name: name, ContainerID: id, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}
}

func openWith(lines ...string) logResponse {
	offsets := make([]time.Duration, len(lines))
	for i := range lines {
		offsets[i] = time.Duration(i+1) * time.Millisecond
	}
	return logResponse{body: buildContainerLogsStream(time.Unix(1000, 0), offsets, lines), holdOpen: true}
}

var podScope = Options{Namespace: "default", Version: "v1", Kind: "pod", Name: "web-0", MaxEntries: 100}

// A StatefulSet pod keeps its name when it is recreated; a single-pod view
// must follow the new pod instead of going quiet.
func TestPodScopeFollowsARecreatedPodWithTheSameName(t *testing.T) {
	spec := corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}
	oldPod := testPod("web-0", spec, corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{runningStatus("app", "containerd://old")}})
	newPod := testPod("web-0", spec, corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{runningStatus("app", "containerd://new")}})
	requests := 0
	harness := startRun(t, podScope, []*corev1.Pod{oldPod}, func(*corev1.PodLogOptions) logResponse {
		requests++
		if requests == 1 {
			return openWith("old line")
		}
		return openWith("new line")
	})

	harness.expectLine("old line")
	harness.send(watch.Deleted, oldPod)
	harness.send(watch.Added, newPod)
	harness.expectLine("new line")
}

func TestPodScopeFollowsANewDebugContainer(t *testing.T) {
	spec := corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}
	pod := testPod("web-0", spec, corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{runningStatus("app", "containerd://a")}})
	harness := startRun(t, podScope, []*corev1.Pod{pod}, func(opts *corev1.PodLogOptions) logResponse {
		return openWith(opts.Container + " line")
	})
	harness.expectLine("app line")

	debugged := pod.DeepCopy()
	debugged.Spec.EphemeralContainers = []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debugger"}}}
	debugged.Status.EphemeralContainerStatuses = []corev1.ContainerStatus{runningStatus("debugger", "containerd://d")}
	harness.send(watch.Modified, debugged)
	harness.expectLine("debugger line")
}

// A new pod's init container is still waiting when the pod first appears; its
// logs must be followed once it starts.
func TestWorkloadScopeFollowsAnInitContainerOnceItRuns(t *testing.T) {
	spec := corev1.PodSpec{InitContainers: []corev1.Container{{Name: "setup"}}, Containers: []corev1.Container{{Name: "app"}}}
	waiting := corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "PodInitializing"}}
	pending := testPod("migrate-abc", spec, corev1.PodStatus{
		Phase:                 corev1.PodPending,
		InitContainerStatuses: []corev1.ContainerStatus{{Name: "setup", State: waiting}},
		ContainerStatuses:     []corev1.ContainerStatus{{Name: "app", State: waiting}},
	})
	setupRequests := 0
	harness := startRun(t, Options{Namespace: "default", Group: "batch", Version: "v1", Kind: "job", Name: "migrate", MaxEntries: 100}, []*corev1.Pod{pending},
		func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "setup" {
				setupRequests++
				if setupRequests == 1 {
					return logResponse{status: http.StatusBadRequest, body: `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"container \"setup\" in pod \"migrate-abc\" is waiting to start: PodInitializing","reason":"BadRequest","code":400}`}
				}
				return openWith("init line")
			}
			return logResponse{holdOpen: true}
		})

	initializing := pending.DeepCopy()
	initializing.Status.InitContainerStatuses = []corev1.ContainerStatus{runningStatus("setup", "containerd://s")}
	require.Eventually(t, func() bool { return harness.logs.requestCount("setup") >= 1 }, 2*time.Second, 5*time.Millisecond)
	harness.send(watch.Modified, initializing)
	harness.expectLine("init line")
}

// A finished container is read once; unrelated pod updates must not reopen it.
func TestCompletedContainerIsNotReopenedOnUnrelatedUpdates(t *testing.T) {
	spec := corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}
	done := testPod("web-0", spec, corev1.PodStatus{Phase: corev1.PodSucceeded, ContainerStatuses: []corev1.ContainerStatus{{
		Name: "app", ContainerID: "containerd://done", State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{}},
	}}})
	harness := startRun(t, podScope, []*corev1.Pod{done}, func(*corev1.PodLogOptions) logResponse {
		return logResponse{body: buildContainerLogsStream(time.Unix(1000, 0), []time.Duration{time.Millisecond}, []string{"final"})}
	})
	harness.expectLine("final")

	relabelled := done.DeepCopy()
	relabelled.Labels["touched"] = "yes"
	for range 3 {
		harness.send(watch.Modified, relabelled)
	}
	time.Sleep(300 * time.Millisecond)
	require.Equal(t, 1, harness.logs.requestCount("app"))
}

// A running container's stream can end without any pod change (kubelet timeouts,
// network blips); the follower resumes it.
func TestRunningContainerStreamIsResumedAfterItEnds(t *testing.T) {
	spec := corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}
	pod := testPod("web-0", spec, corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{runningStatus("app", "containerd://a")}})
	requests := 0
	harness := startRun(t, podScope, []*corev1.Pod{pod}, func(*corev1.PodLogOptions) logResponse {
		requests++
		if requests == 1 {
			return logResponse{body: buildContainerLogsStream(time.Unix(1000, 0), []time.Duration{time.Millisecond}, []string{"before"})}
		}
		return openWith("before", "after")
	})
	harness.expectLine("before")
	harness.expectLine("after")
}

func jobPod(name, job, container string) *corev1.Pod {
	pod := testPod(name, corev1.PodSpec{Containers: []corev1.Container{{Name: container}}}, corev1.PodStatus{
		Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{runningStatus(container, "containerd://"+name)},
	})
	pod.Labels = map[string]string{"job-name": job}
	return pod
}

func linesPerContainer(opts *corev1.PodLogOptions) logResponse {
	return openWith(opts.Container + " line")
}

var jobScope = Options{Namespace: "default", Group: "batch", Version: "v1", Kind: "job", Name: "migrate", MaxEntries: 100}

// A pod watch whose resource version expired is re-listed: pods created during
// the gap are followed, pods deleted during it are stopped, and the routine
// expiry is not reported to the user.
func TestExpiredPodWatchRelistsCreatedAndDeletedPods(t *testing.T) {
	stoppedA := make(chan struct{})
	var once sync.Once
	harness := startRunWith(t, runSetup{opts: jobScope, initial: []*corev1.Pod{jobPod("migrate-a", "migrate", "a")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			response := linesPerContainer(opts)
			if opts.Container == "a" {
				response.onClose = func() { once.Do(func() { close(stoppedA) }) }
			}
			return response
		}})
	harness.expectLine("a line")
	firstWatch := harness.watcher(1)

	pods := corev1.SchemeGroupVersion.WithResource("pods")
	require.NoError(t, harness.client.Tracker().Delete(pods, "default", "migrate-a"))
	require.NoError(t, harness.client.Tracker().Add(jobPod("migrate-b", "migrate", "b")))
	firstWatch.ch <- watch.Event{Type: watch.Error, Object: &metav1.Status{
		Status: metav1.StatusFailure, Code: http.StatusGone, Reason: metav1.StatusReasonExpired, Message: "too old resource version",
	}}

	harness.expectLine("b line")
	select {
	case <-stoppedA:
	case <-time.After(5 * time.Second):
		t.Fatal("the deleted pod's follower was not stopped")
	}
	require.Empty(t, harness.errs, "an expired watch is routine and must not surface an error")
}

// A CronJob's next Job has a new name; its pods are followed through the Job's
// owner, and another CronJob's pods in the namespace are not.
func TestCronJobScopeFollowsPodsOfAFutureJob(t *testing.T) {
	ownedBy := func(cronJob string) []metav1.OwnerReference {
		return []metav1.OwnerReference{{Kind: "CronJob", Name: cronJob}}
	}
	harness := startRunWith(t, runSetup{
		opts:    Options{Namespace: "default", Group: "batch", Version: "v1", Kind: "cronjob", Name: "nightly", MaxEntries: 100},
		respond: linesPerContainer,
	})
	require.NoError(t, harness.client.Tracker().Add(&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "hourly-1", OwnerReferences: ownedBy("hourly")}}))
	require.NoError(t, harness.client.Tracker().Add(&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "nightly-2", OwnerReferences: ownedBy("nightly")}}))

	// Events are applied in order, so once the nightly pod is followed the
	// hourly pod has already been considered.
	harness.send(watch.Added, jobPod("hourly-1-x", "hourly-1", "hourly"))
	harness.send(watch.Added, jobPod("nightly-2-x", "nightly-2", "nightly"))
	harness.expectLine("nightly line")
	require.Zero(t, harness.logs.requestCount("hourly"))
}

// A user who may read a pod but not list or watch pods is told once, not on
// every informer retry.
func TestPodWatchPermissionFailureIsReportedOnce(t *testing.T) {
	var lists atomic.Int32
	harness := startRunWith(t, runSetup{
		opts: podScope, initial: []*corev1.Pod{jobPod("web-0", "migrate", "app")}, respond: linesPerContainer,
		prepare: func(client *fake.Clientset) {
			client.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
				lists.Add(1)
				return true, nil, apierrors.NewForbidden(corev1.Resource("pods"), "", errors.New("list denied"))
			})
		},
	})
	harness.expectLine("app line")

	select {
	case err := <-harness.errs:
		require.True(t, apierrors.IsForbidden(err), "got %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("the permission failure was not reported")
	}
	require.Eventually(t, func() bool { return lists.Load() >= 2 }, 5*time.Second, 10*time.Millisecond, "the informer should keep retrying")
	require.Empty(t, harness.errs)
}

// A target held back by the global target cap starts as soon as another
// session releases capacity.
func TestTargetHeldByTheGlobalCapStartsWhenCapacityFrees(t *testing.T) {
	limiter := NewGlobalTargetLimiter(1)
	holder := limiter.StartSession("cluster-a", "a-holder")
	holder.UpdateDesired([]string{"default/other/container:app"})
	harness := startRunWith(t, runSetup{
		opts: podScope, initial: []*corev1.Pod{jobPod("web-0", "migrate", "app")}, respond: linesPerContainer,
		limiter: limiter.StartSession("cluster-a", "z-waiting"),
	})
	require.Never(t, func() bool { return harness.logs.requestCount("app") > 0 }, 200*time.Millisecond, 10*time.Millisecond)

	holder.Release()
	harness.expectLine("app line")
}

// A pod deleted after the session resolved its pods but before the informer's
// first list is never reported deleted by the informer, which never saw it. It
// must still give up its capacity so a replacement pod streams.
func TestPodDeletedBeforeTheInformerListReleasesItsCapacity(t *testing.T) {
	limiter := NewGlobalTargetLimiter(1)
	pods := corev1.SchemeGroupVersion.WithResource("pods")
	harness := startRunWith(t, runSetup{
		opts: jobScope, initial: []*corev1.Pod{jobPod("migrate-a", "migrate", "a")}, respond: linesPerContainer,
		limiter: limiter.StartSession("cluster-a", "session"),
		afterResolve: func(client *fake.Clientset) {
			require.NoError(t, client.Tracker().Delete(pods, "default", "migrate-a"))
			require.NoError(t, client.Tracker().Add(jobPod("migrate-b", "migrate", "b")))
		},
	})

	harness.expectLine("b line")
}
