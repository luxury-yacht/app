package logstream

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/podlogs"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/config"
)

func TestBuildTargetsFromPod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "sidecar"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}},
			},
		},
	}

	targets := buildTargetsFromPod(pod, podlogs.DefaultContainerSelection(""))
	if len(targets) != 4 {
		t.Fatalf("expected 4 targets, got %d", len(targets))
	}

	if !targets[0].isInit || targets[0].container != "init" {
		t.Fatalf("expected init container first target, got %+v", targets[0])
	}
	if targets[3].container != "debug-abc" || targets[3].isInit {
		t.Fatalf("expected ephemeral container target last, got %+v", targets[3])
	}

	filtered := buildTargetsFromPod(pod, podlogs.DefaultContainerSelection("app"))
	if len(filtered) != 1 || filtered[0].container != "app" {
		t.Fatalf("expected filtered target for 'app', got %+v", filtered)
	}

	filteredInit := buildTargetsFromPod(pod, podlogs.DefaultContainerSelection("init (init)"))
	if len(filteredInit) != 1 || !filteredInit[0].isInit {
		t.Fatalf("expected init filter to match init container, got %+v", filteredInit)
	}

	filteredDebug := buildTargetsFromPod(
		pod,
		podlogs.DefaultContainerSelection("debug-abc (debug)"),
	)
	if len(filteredDebug) != 1 || filteredDebug[0].container != "debug-abc" || filteredDebug[0].isInit {
		t.Fatalf("expected debug filter to match ephemeral container, got %+v", filteredDebug)
	}
}

func TestMatchContainerFilterVariants(t *testing.T) {
	if !matchContainerFilter("app", "", false, false) {
		t.Fatal("empty filter should match")
	}
	if !matchContainerFilter("init", "init (init)", true, false) {
		t.Fatal("init suffix should match init container")
	}
	if !matchContainerFilter("debug-abc", "debug-abc (debug)", false, true) {
		t.Fatal("debug suffix should match ephemeral container")
	}
	if matchContainerFilter("sidecar", "main", false, false) {
		t.Fatal("unexpected match")
	}
}

func TestSelectRuntimeTargetsKeepsPerScopeCapWhenPodsGrow(t *testing.T) {
	pods := []*corev1.Pod{
		testLogPod("default", "web-1", corev1.PodRunning, true, "app"),
		testLogPod("default", "web-2", corev1.PodRunning, true, "app"),
	}

	selected, total := selectRuntimeTargets(pods, podlogs.DefaultContainerSelection(""), 2)
	if total != 2 {
		t.Fatalf("expected total target count 2, got %d", total)
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-1/container:app,default/web-2/container:app" {
		t.Fatalf("unexpected initial target keys: %v", keys)
	}

	pods = append(pods, testLogPod("default", "web-3", corev1.PodRunning, true, "app"))
	selected, total = selectRuntimeTargets(pods, podlogs.DefaultContainerSelection(""), 2)
	if total != 3 {
		t.Fatalf("expected total target count 3 after pod growth, got %d", total)
	}
	if len(selected) != 2 {
		t.Fatalf("expected capped selection of 2 targets after pod growth, got %d", len(selected))
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-1/container:app,default/web-2/container:app" {
		t.Fatalf("unexpected capped target keys after pod growth: %v", keys)
	}
}

func TestSelectRuntimeTargetsRefillsAfterPodRemoval(t *testing.T) {
	pods := []*corev1.Pod{
		testLogPod("default", "web-1", corev1.PodRunning, true, "app"),
		testLogPod("default", "web-2", corev1.PodRunning, true, "app"),
		testLogPod("default", "web-3", corev1.PodRunning, true, "app"),
	}

	selected, total := selectRuntimeTargets(pods, podlogs.DefaultContainerSelection(""), 2)
	if total != 3 {
		t.Fatalf("expected total target count 3, got %d", total)
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-1/container:app,default/web-2/container:app" {
		t.Fatalf("unexpected initial capped target keys: %v", keys)
	}

	selected, total = selectRuntimeTargets(pods[1:], podlogs.DefaultContainerSelection(""), 2)
	if total != 2 {
		t.Fatalf("expected total target count 2 after pod removal, got %d", total)
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-2/container:app,default/web-3/container:app" {
		t.Fatalf("expected selection to refill after pod removal, got %v", keys)
	}
}

func TestListPodsForPodKind(t *testing.T) {
	ctx := context.Background()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
	}
	client := fake.NewClientset(pod)
	streamer := NewStreamer(client, nil, nil)

	pods, selector, err := streamer.listPods(ctx, Options{Kind: "pod", Namespace: "default", Name: "pod-1"})
	if err != nil {
		t.Fatalf("listPods returned error: %v", err)
	}
	if selector != "" {
		t.Fatalf("expected empty selector for pod kind, got %q", selector)
	}
	if len(pods) != 1 || pods[0].Name != "pod-1" {
		t.Fatalf("expected single pod-1 result, got %#v", pods)
	}
}

func TestListPodsSelectorError(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset()
	streamer := NewStreamer(client, nil, nil)

	if _, _, err := streamer.listPods(ctx, Options{Kind: "unsupported", Namespace: "default", Name: "x"}); err == nil {
		t.Fatal("expected unsupported selector error")
	}
}

func TestListPodsForDeployment(t *testing.T) {
	ctx := context.Background()
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podMatch := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1", Labels: map[string]string{"app": "web"}},
	}
	podMiss := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-2", Labels: map[string]string{"app": "other"}},
	}
	client := fake.NewClientset([]runtime.Object{deployment, podMatch, podMiss}...)
	streamer := NewStreamer(client, nil, nil)

	pods, selector, err := streamer.listPods(ctx, Options{Kind: "deployment", Namespace: "default", Name: "web"})
	if err != nil {
		t.Fatalf("listPods returned error: %v", err)
	}
	if selector == "" {
		t.Fatal("expected selector for deployment scope")
	}
	if len(pods) != 1 || pods[0].Name != "pod-1" {
		t.Fatalf("expected pod-1 to match selector, got %#v", pods)
	}
}

func TestListPodsAppliesPodFilter(t *testing.T) {
	ctx := context.Background()
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podOne := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web-1", Labels: map[string]string{"app": "web"}},
	}
	podTwo := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web-2", Labels: map[string]string{"app": "web"}},
	}
	client := fake.NewClientset([]runtime.Object{deployment, podOne, podTwo}...)
	streamer := NewStreamer(client, nil, nil)

	pods, selector, err := streamer.listPods(ctx, Options{
		Kind:      "deployment",
		Namespace: "default",
		Name:      "web",
		PodFilter: "web-2",
	})
	if err != nil {
		t.Fatalf("listPods returned error: %v", err)
	}
	if selector == "" {
		t.Fatal("expected selector for deployment scope")
	}
	if len(pods) != 1 || pods[0].Name != "web-2" {
		t.Fatalf("expected only web-2 after pod filter, got %#v", pods)
	}
}

func TestListPodsAppliesPodNameRegexFilters(t *testing.T) {
	ctx := context.Background()
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podOne := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web-api-1", Labels: map[string]string{"app": "web"}},
	}
	podTwo := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web-worker-1", Labels: map[string]string{"app": "web"}},
	}
	podThree := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web-api-canary", Labels: map[string]string{"app": "web"}},
	}
	client := fake.NewClientset([]runtime.Object{deployment, podOne, podTwo, podThree}...)
	streamer := NewStreamer(client, nil, nil)
	podNameFilter, err := podlogs.NewPodNameFilter("api", "canary$")
	if err != nil {
		t.Fatalf("unexpected pod filter error: %v", err)
	}

	pods, selector, err := streamer.listPods(ctx, Options{
		Kind:          "deployment",
		Namespace:     "default",
		Name:          "web",
		PodNameFilter: podNameFilter,
		PodInclude:    "api",
		PodExclude:    "canary$",
	})
	if err != nil {
		t.Fatalf("listPods returned error: %v", err)
	}
	if selector == "" {
		t.Fatal("expected selector for deployment scope")
	}
	if len(pods) != 1 || pods[0].Name != "web-api-1" {
		t.Fatalf("expected only web-api-1 after pod regex filters, got %#v", pods)
	}
}

func TestListPodsForReplicaSet(t *testing.T) {
	ctx := context.Background()
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "rs1"},
		Spec: appsv1.ReplicaSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "rs"}},
		},
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1", Labels: map[string]string{"app": "rs"}},
	}
	client := fake.NewClientset(rs, pod)
	streamer := NewStreamer(client, nil, nil)

	pods, selector, err := streamer.listPods(ctx, Options{Kind: "replicaset", Namespace: "default", Name: "rs1"})
	if err != nil {
		t.Fatalf("listPods returned error: %v", err)
	}
	if selector == "" || len(pods) != 1 {
		t.Fatalf("expected selector and single pod, got selector=%q pods=%d", selector, len(pods))
	}
}

func TestPodBelongsToCronJob(t *testing.T) {
	ctx := context.Background()
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "job-1",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "CronJob", Name: "nightly"},
			},
		},
	}
	client := fake.NewClientset(job)
	streamer := NewStreamer(client, nil, nil)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "pod-1",
			Labels:    map[string]string{"job-name": "job-1"},
		},
	}
	cache := map[string]bool{}
	if !streamer.podBelongsToCronJob(ctx, "default", "nightly", pod, cache) {
		t.Fatal("expected pod to belong to cronjob")
	}

	if streamer.podBelongsToCronJob(ctx, "default", "other", pod, cache) {
		t.Fatal("expected cronjob mismatch to return false")
	}
	if cache["job-1/nightly"] != true || cache["job-1/other"] != false {
		t.Fatalf("expected cache to contain keyed results, got %+v", cache)
	}
}

func testLogPod(namespace, name string, phase corev1.PodPhase, ready bool, containers ...string) *corev1.Pod {
	containerSpecs := make([]corev1.Container, 0, len(containers))
	for _, container := range containers {
		containerSpecs = append(containerSpecs, corev1.Container{Name: container})
	}
	conditions := []corev1.PodCondition{}
	if ready {
		conditions = append(conditions, corev1.PodCondition{
			Type:   corev1.PodReady,
			Status: corev1.ConditionTrue,
		})
	}
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: namespace,
			Name:      name,
		},
		Spec: corev1.PodSpec{
			Containers: containerSpecs,
		},
		Status: corev1.PodStatus{
			Phase:      phase,
			Conditions: conditions,
		},
	}
}

func runtimeTargetKeys(targets []containerTarget) []string {
	keys := make([]string, 0, len(targets))
	for _, target := range targets {
		keys = append(keys, target.key())
	}
	return keys
}

func TestListPodsErrorPropagates(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("list failed")
	})
	streamer := NewStreamer(client, nil, nil)

	if _, _, err := streamer.listPods(ctx, Options{Kind: "pod", Namespace: "default", Name: "pod-1"}); err == nil {
		t.Fatal("expected error from underlying client")
	}
}

func TestPodPointersReturnsNewSlice(t *testing.T) {
	pods := []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "a"}}, {ObjectMeta: metav1.ObjectMeta{Name: "b"}}}
	ptrs := podPointers(pods)
	if len(ptrs) != 2 {
		t.Fatalf("expected two pointers, got %d", len(ptrs))
	}
	if ptrs[0].Name != "a" || ptrs[1].Name != "b" {
		t.Fatalf("unexpected pod names %#v", ptrs)
	}
	if ptrs[0] == &pods[0] {
		t.Fatal("expected pointers to point to copies, not original slice elements")
	}
}

type fakeWatch struct {
	ch chan watch.Event
}

func (f *fakeWatch) Stop() {
	close(f.ch)
}

func (f *fakeWatch) ResultChan() <-chan watch.Event {
	return f.ch
}

func TestConsumeWatchReturnsErrorOnWatchErrorEvent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	streamer := NewStreamer(fake.NewClientset(), nil, nil)
	fw := &fakeWatch{ch: make(chan watch.Event, 1)}
	resultCh := make(chan error, 1)

	go func() {
		resultCh <- streamer.consumeWatch(ctx, fw, Options{}, map[string]bool{}, func(*corev1.Pod) {}, func(string) {})
	}()

	fw.ch <- watch.Event{
		Type:   watch.Error,
		Object: &metav1.Status{Message: "boom"},
	}

	select {
	case err := <-resultCh:
		if err == nil || !strings.Contains(err.Error(), "boom") {
			t.Fatalf("expected watch error to propagate, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for consumeWatch to return")
	}
}

func TestWaitForReconnect(t *testing.T) {
	streamer := NewStreamer(nil, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if streamer.waitForReconnect(ctx, time.Millisecond*10) {
		t.Fatal("expected cancelled context to return false")
	}

	start := time.Now()
	if !streamer.waitForReconnect(context.Background(), time.Millisecond*5) {
		t.Fatal("expected wait to complete when context is active")
	}
	if time.Since(start) < 4*time.Millisecond {
		t.Fatal("expected waitForReconnect to respect the delay")
	}
}

func TestNextBackoff(t *testing.T) {
	if next := nextBackoff(0); next != config.LogStreamBackoffInitial {
		t.Fatalf("expected initial backoff %v, got %v", config.LogStreamBackoffInitial, next)
	}

	if next := nextBackoff(config.LogStreamBackoffInitial); next != config.LogStreamBackoffInitial*2 {
		t.Fatalf("expected backoff doubling, got %v", next)
	}

	if next := nextBackoff(config.LogStreamBackoffMax * 2); next != config.LogStreamBackoffMax {
		t.Fatalf("expected max backoff cap %v, got %v", config.LogStreamBackoffMax, next)
	}
}

func TestListPodsForCronJobBatched(t *testing.T) {
	// Two Jobs owned by the same CronJob, each with one pod.
	job1 := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:       "default",
			Name:            "cron-abc",
			OwnerReferences: []metav1.OwnerReference{{Kind: "CronJob", Name: "cron"}},
		},
	}
	job2 := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:       "default",
			Name:            "cron-def",
			OwnerReferences: []metav1.OwnerReference{{Kind: "CronJob", Name: "cron"}},
		},
	}
	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "pod-abc",
			Labels:    map[string]string{"job-name": "cron-abc"},
		},
	}
	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "pod-def",
			Labels:    map[string]string{"job-name": "cron-def"},
		},
	}
	// Unrelated pod in same namespace should not be returned.
	unrelated := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "other-pod",
			Labels:    map[string]string{"job-name": "unrelated-job"},
		},
	}

	client := fake.NewClientset(job1, job2, pod1, pod2, unrelated)

	// Count pod list calls to verify batching.
	podListCalls := 0
	client.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		podListCalls++
		return false, nil, nil // pass through to default handler
	})

	streamer := NewStreamer(client, nil, nil)
	ctx := context.Background()
	pods, selector, err := streamer.listPods(ctx, Options{
		Kind:      "cronjob",
		Namespace: "default",
		Name:      "cron",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should return both pods in a single batched call.
	if podListCalls != 1 {
		t.Fatalf("expected 1 pod list call (batched), got %d", podListCalls)
	}
	if len(pods) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(pods))
	}
	names := map[string]bool{}
	for _, p := range pods {
		names[p.Name] = true
	}
	if !names["pod-abc"] || !names["pod-def"] {
		t.Fatalf("expected pod-abc and pod-def, got %v", names)
	}

	// Selector must be empty so the watch sees pods from future Jobs.
	if selector != "" {
		t.Fatalf("expected empty selector for CronJob watch, got %q", selector)
	}
}

func TestCronJobWatchPicksUpFutureJob(t *testing.T) {
	// A new Job appears after the stream starts. The watch (empty selector)
	// should deliver it, and consumeWatch should accept it via podBelongsToCronJob.
	futureJob := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:       "default",
			Name:            "cron-ghi",
			OwnerReferences: []metav1.OwnerReference{{Kind: "CronJob", Name: "cron"}},
		},
	}
	client := fake.NewClientset(futureJob)
	streamer := NewStreamer(client, nil, nil)

	futurePod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "pod-ghi",
			Labels:    map[string]string{"job-name": "cron-ghi"},
		},
	}

	fw := &fakeWatch{ch: make(chan watch.Event, 1)}
	var started []string
	startPod := func(pod *corev1.Pod) { started = append(started, pod.Name) }
	stopPod := func(string) {}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	resultCh := make(chan error, 1)
	go func() {
		resultCh <- streamer.consumeWatch(ctx, fw, Options{Kind: "cronjob", Namespace: "default", Name: "cron"}, map[string]bool{}, startPod, stopPod)
	}()

	// Deliver a pod from the future Job via the watch.
	fw.ch <- watch.Event{Type: watch.Added, Object: futurePod}

	// Close the watch to let consumeWatch return.
	close(fw.ch)

	select {
	case <-resultCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for consumeWatch")
	}

	if len(started) != 1 || started[0] != "pod-ghi" {
		t.Fatalf("expected future pod to be started, got %v", started)
	}
}
