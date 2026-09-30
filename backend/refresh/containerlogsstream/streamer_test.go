package containerlogsstream

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/stretchr/testify/require"
)

func TestSelectRuntimeTargetsKeepsPerScopeCapWhenPodsGrow(t *testing.T) {
	pods := []*corev1.Pod{
		testLogPod("default", "web-1", corev1.PodRunning, true, "app"),
		testLogPod("default", "web-2", corev1.PodRunning, true, "app"),
	}

	selected, total := selectRuntimeTargets(pods, containerlogs.ScopeSelection{}, 2)
	if total != 2 {
		t.Fatalf("expected total target count 2, got %d", total)
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-1/container:app,default/web-2/container:app" {
		t.Fatalf("unexpected initial target keys: %v", keys)
	}

	pods = append(pods, testLogPod("default", "web-3", corev1.PodRunning, true, "app"))
	selected, total = selectRuntimeTargets(pods, containerlogs.ScopeSelection{}, 2)
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

	selected, total := selectRuntimeTargets(pods, containerlogs.ScopeSelection{}, 2)
	if total != 3 {
		t.Fatalf("expected total target count 3, got %d", total)
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-1/container:app,default/web-2/container:app" {
		t.Fatalf("unexpected initial capped target keys: %v", keys)
	}

	selected, total = selectRuntimeTargets(pods[1:], containerlogs.ScopeSelection{}, 2)
	if total != 2 {
		t.Fatalf("expected total target count 2 after pod removal, got %d", total)
	}
	if keys := runtimeTargetKeys(selected); strings.Join(keys, ",") != "default/web-2/container:app,default/web-3/container:app" {
		t.Fatalf("expected selection to refill after pod removal, got %v", keys)
	}
}

func TestMatchNoneTailAndStreamDoNotTouchKubernetes(t *testing.T) {
	client := fake.NewClientset()
	streamer := NewStreamer(client, nil, nil)
	opts := Options{
		ClusterID: "cluster-a",
		Namespace: "default",
		Group:     "",
		Version:   "v1",
		Kind:      "Pod",
		Name:      "pod-1",
		MatchNone: true,
	}

	initial, err := streamer.prepare(context.Background(), opts, nil)
	require.NoError(t, err)
	require.Empty(t, initial.pods)
	require.Nil(t, initial.watch)
	require.Empty(t, initial.warnings)
	require.Empty(t, client.Actions())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		streamer.run(
			ctx,

			initial.pods,
			initial.watch, containerLogRunConfig{opts: opts, limiterSession: nil, initialWarnings: initial.warnings, sink: testPending()})

	}()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("MatchNone stream did not stop after cancellation")
	}
	require.Empty(t, client.Actions())
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

type fakeWatch struct {
	ch   chan watch.Event
	once sync.Once
}

func (f *fakeWatch) Stop() {
	f.once.Do(func() { close(f.ch) })
}

func (f *fakeWatch) ResultChan() <-chan watch.Event {
	return f.ch
}

func TestStreamerRunCancellationBeforeAndAfterStartup(t *testing.T) {
	streamer := NewStreamer(fake.NewClientset(), nil, nil)

	t.Run("cancelled before match-none startup", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		done := make(chan struct{})
		go func() {
			streamer.run(ctx, nil, nil, containerLogRunConfig{opts: Options{MatchNone: true}, limiterSession: nil, initialWarnings: nil, sink: testPending()})
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("match-none stream did not honor pre-start cancellation")
		}
	})

	t.Run("cancelled after pod stream startup", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			streamer.run(ctx, nil, nil, containerLogRunConfig{opts: Options{Kind: "pod"}, limiterSession: nil, initialWarnings: nil, sink: testPending()})
			close(done)
		}()
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("pod stream did not honor cancellation after startup")
		}
	})
}

func testPending() *pendingEntries {
	return newPendingEntries(1000, 1<<20)
}
