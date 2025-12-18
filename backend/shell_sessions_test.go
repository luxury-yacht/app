package backend

import (
	"context"
	"io"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

func TestTerminalSizeQueueBehavior(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Set(0, 10) // ignored
	q.Set(80, 24)
	size := q.Next()
	if size == nil || size.Width != 80 || size.Height != 24 {
		t.Fatalf("unexpected size %#v", size)
	}
	q.Close()
	if val := q.Next(); val != nil {
		t.Fatalf("expected nil after close, got %#v", val)
	}
}

func TestShellEventWriterEmits(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	events := make([]ShellOutputEvent, 0, 1)
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == shellOutputEventName && len(args) == 1 {
			if ev, ok := args[0].(ShellOutputEvent); ok {
				events = append(events, ev)
			}
		}
	}

	writer := &shellEventWriter{app: app, sessionID: "s1", stream: "stdout"}
	n, err := writer.Write([]byte("hello"))
	if err != nil || n != len("hello") {
		t.Fatalf("write failed: %v", err)
	}
	if len(events) != 1 || events[0].Data != "hello" || events[0].Stream != "stdout" {
		t.Fatalf("unexpected events %+v", events)
	}
}

func TestShellSessionLifecycleHelpers(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.shellSessions = make(map[string]*shellSession)

	stdinR, stdinW := io.Pipe()
	sizeQueue := newTerminalSizeQueue()
	sess := &shellSession{
		id:        "sess",
		stdin:     stdinW,
		stdinR:    stdinR,
		sizeQueue: sizeQueue,
		cancel:    func() {},
	}
	app.shellSessions["sess"] = sess

	app.eventEmitter = func(context.Context, string, ...interface{}) {}

	readCh := make(chan string, 1)
	go func() {
		buf := make([]byte, 4)
		n, _ := stdinR.Read(buf)
		readCh <- string(buf[:n])
	}()

	if err := app.SendShellInput("sess", "data"); err != nil {
		t.Fatalf("SendShellInput error: %v", err)
	}
	if got := <-readCh; got != "data" {
		t.Fatalf("stdin read mismatch: %q", got)
	}

	if err := app.ResizeShellSession("sess", 120, 50); err != nil {
		t.Fatalf("ResizeShellSession error: %v", err)
	}
	s := sizeQueue.Next()
	if s == nil || s.Width != 120 || s.Height != 50 {
		t.Fatalf("unexpected size after resize %#v", s)
	}

	events := make([]ShellStatusEvent, 0, 1)
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == shellStatusEventName && len(args) == 1 {
			if ev, ok := args[0].(ShellStatusEvent); ok {
				events = append(events, ev)
			}
		}
	}
	if err := app.CloseShellSession("sess"); err != nil {
		t.Fatalf("CloseShellSession error: %v", err)
	}
	if app.getShellSession("sess") != nil {
		t.Fatalf("expected session to be removed")
	}
	if len(events) != 1 || events[0].Status != "closed" {
		t.Fatalf("unexpected status events %+v", events)
	}
}

func TestShellSessionMissingGuards(t *testing.T) {
	app := newTestAppWithDefaults(t)
	if err := app.SendShellInput("missing", "x"); err == nil {
		t.Fatalf("expected error for missing session")
	}
	if err := app.ResizeShellSession("missing", -1, 0); err == nil {
		t.Fatalf("expected error for invalid resize")
	}
	if err := app.CloseShellSession("missing"); err == nil {
		t.Fatalf("expected error for missing session close")
	}
}

func TestHasContainer(t *testing.T) {
	containers := []corev1.Container{
		{Name: "a"},
		{Name: "b"},
	}
	if !hasContainer(containers, "a") {
		t.Fatalf("expected container a to be found")
	}
	if hasContainer(containers, "c") {
		t.Fatalf("unexpected match for missing container")
	}
}

func TestEmitShellEventsGuards(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	calls := 0
	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {
		calls++
	}

	// guard cases
	app.emitShellOutput("", "stdout", "data")
	app.emitShellOutput("id", "stdout", "")
	app.emitShellStatus("", "open", "")
	app.emitShellStatus("id", "", "")
	if calls != 0 {
		t.Fatalf("expected no events for guarded inputs, got %d", calls)
	}

	// happy paths
	app.emitShellOutput("id", "stdout", "line")
	app.emitShellStatus("id", "open", "reason")
	if calls != 2 {
		t.Fatalf("expected 2 events emitted, got %d", calls)
	}
}

func TestStartShellSessionValidation(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// missing client should fail fast
	if _, err := app.StartShellSession(ShellSessionRequest{}); err == nil {
		t.Fatal("expected error when client is nil")
	}

	app.client = fake.NewSimpleClientset()
	app.restConfig = &rest.Config{}

	if _, err := app.StartShellSession(ShellSessionRequest{}); err == nil {
		t.Fatal("expected namespace validation error")
	}
	if _, err := app.StartShellSession(ShellSessionRequest{Namespace: "ns"}); err == nil {
		t.Fatal("expected pod name validation error")
	}
}

func TestStartShellSessionPodValidation(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.restConfig = &rest.Config{}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
		Spec:       corev1.PodSpec{}, // no containers
	}
	app.client = fake.NewSimpleClientset(pod)

	_, err := app.StartShellSession(ShellSessionRequest{Namespace: "default", PodName: "pod-1"})
	if err == nil {
		t.Fatal("expected error when pod has no containers")
	}

	pod.Spec.Containers = []corev1.Container{{Name: "main"}}
	app.client = fake.NewSimpleClientset(pod)

	if _, err := app.StartShellSession(ShellSessionRequest{Namespace: "default", PodName: "pod-1", Container: "missing"}); err == nil {
		t.Fatal("expected error for missing container")
	}
}
