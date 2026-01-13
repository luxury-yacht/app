package logstream

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

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
		},
	}

	targets := buildTargetsFromPod(pod, "")
	if len(targets) != 3 {
		t.Fatalf("expected 3 targets, got %d", len(targets))
	}

	if !targets[0].isInit || targets[0].container != "init" {
		t.Fatalf("expected init container first target, got %+v", targets[0])
	}

	filtered := buildTargetsFromPod(pod, "app")
	if len(filtered) != 1 || filtered[0].container != "app" {
		t.Fatalf("expected filtered target for 'app', got %+v", filtered)
	}

	filteredInit := buildTargetsFromPod(pod, "init (init)")
	if len(filteredInit) != 1 || !filteredInit[0].isInit {
		t.Fatalf("expected init filter to match init container, got %+v", filteredInit)
	}
}

func TestMatchContainerFilterVariants(t *testing.T) {
	if !matchContainerFilter("app", "", false) {
		t.Fatal("empty filter should match")
	}
	if !matchContainerFilter("init", "init (init)", true) {
		t.Fatal("init suffix should match init container")
	}
	if matchContainerFilter("sidecar", "main", false) {
		t.Fatal("unexpected match")
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
