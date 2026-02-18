package backend

import (
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

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

	sess := &shellSession{}
	writer := &shellEventWriter{
		app: app, sessionID: "s1", clusterID: "cluster1", stream: "stdout", session: sess,
	}
	n, err := writer.Write([]byte("hello"))
	if err != nil || n != len("hello") {
		t.Fatalf("write failed: %v", err)
	}
	if len(events) != 1 || events[0].Data != "hello" || events[0].Stream != "stdout" || events[0].ClusterID != "cluster1" {
		t.Fatalf("unexpected events %+v", events)
	}
	if backlog := sess.snapshotBacklog(); backlog != "hello" {
		t.Fatalf("unexpected backlog %q", backlog)
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
		clusterID: "cluster1",
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
	if len(events) != 1 || events[0].Status != "closed" || events[0].ClusterID != "cluster1" {
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

func TestListShellSessionsAndClusterCount(t *testing.T) {
	app := newTestAppWithDefaults(t)
	now := time.Now()
	app.shellSessions = map[string]*shellSession{
		"s1": {
			id:          "s1",
			clusterID:   "cluster-a",
			clusterName: "cluster-a-name",
			namespace:   "ns-a",
			podName:     "pod-a",
			container:   "app",
			command:     []string{"/bin/sh"},
			startedAt:   now.Add(-2 * time.Minute),
		},
		"s2": {
			id:          "s2",
			clusterID:   "cluster-b",
			clusterName: "cluster-b-name",
			namespace:   "ns-b",
			podName:     "pod-b",
			container:   "debug",
			command:     []string{"/bin/bash"},
			startedAt:   now.Add(-1 * time.Minute),
		},
	}

	sessions := app.ListShellSessions()
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	if sessions[0].SessionID != "s1" || sessions[1].SessionID != "s2" {
		t.Fatalf("expected sessions sorted by startedAt, got %+v", sessions)
	}
	if sessions[0].ClusterName != "cluster-a-name" {
		t.Fatalf("unexpected cluster name: %+v", sessions[0])
	}
	if count := app.GetClusterShellSessionCount("cluster-a"); count != 1 {
		t.Fatalf("expected cluster-a count 1, got %d", count)
	}
	if count := app.GetClusterShellSessionCount("cluster-b"); count != 1 {
		t.Fatalf("expected cluster-b count 1, got %d", count)
	}
}

func TestStopClusterShellSessions(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.shellSessions = map[string]*shellSession{
		"s1": {id: "s1", clusterID: "cluster-a"},
		"s2": {id: "s2", clusterID: "cluster-a"},
		"s3": {id: "s3", clusterID: "cluster-b"},
	}

	statusEvents := make([]ShellStatusEvent, 0)
	listEvents := make([][]ShellSessionInfo, 0)
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if len(args) != 1 {
			return
		}
		switch name {
		case shellStatusEventName:
			if ev, ok := args[0].(ShellStatusEvent); ok {
				statusEvents = append(statusEvents, ev)
			}
		case shellListEventName:
			if ev, ok := args[0].([]ShellSessionInfo); ok {
				listEvents = append(listEvents, ev)
			}
		}
	}

	if err := app.StopClusterShellSessions("cluster-a"); err != nil {
		t.Fatalf("StopClusterShellSessions error: %v", err)
	}
	if app.getShellSession("s1") != nil || app.getShellSession("s2") != nil {
		t.Fatalf("expected cluster-a sessions removed")
	}
	if app.getShellSession("s3") == nil {
		t.Fatalf("expected cluster-b session to remain")
	}
	if len(statusEvents) != 2 {
		t.Fatalf("expected 2 status events, got %d", len(statusEvents))
	}
	for _, ev := range statusEvents {
		if ev.Status != "closed" || ev.Reason != "cluster disconnected" || ev.ClusterID != "cluster-a" {
			t.Fatalf("unexpected status event: %+v", ev)
		}
	}
	if len(listEvents) != 1 {
		t.Fatalf("expected 1 list event, got %d", len(listEvents))
	}
	if len(listEvents[0]) != 1 || listEvents[0][0].SessionID != "s3" {
		t.Fatalf("unexpected list payload: %+v", listEvents[0])
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

func TestHasEphemeralContainer(t *testing.T) {
	containers := []corev1.EphemeralContainer{
		{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-a"}},
		{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-b"}},
	}
	if !hasEphemeralContainer(containers, "debug-a") {
		t.Fatalf("expected ephemeral container debug-a to be found")
	}
	if hasEphemeralContainer(containers, "missing") {
		t.Fatalf("unexpected match for missing ephemeral container")
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
	app.emitShellOutput("", "cluster1", "stdout", "data")
	app.emitShellOutput("id", "cluster1", "stdout", "")
	app.emitShellStatus("", "cluster1", "open", "")
	app.emitShellStatus("id", "cluster1", "", "")
	if calls != 0 {
		t.Fatalf("expected no events for guarded inputs, got %d", calls)
	}

	// happy paths
	app.emitShellOutput("id", "cluster1", "stdout", "line")
	app.emitShellStatus("id", "cluster1", "open", "reason")
	if calls != 2 {
		t.Fatalf("expected 2 events emitted, got %d", calls)
	}
}

func TestShellSessionBacklogIsBounded(t *testing.T) {
	sess := &shellSession{}
	for i := 0; i < 100; i++ {
		chunk := fmt.Sprintf("[%03d]%s", i, strings.Repeat("x", 4090))
		sess.appendBacklog(chunk)
	}

	backlog := sess.snapshotBacklog()
	if len(backlog) == 0 {
		t.Fatalf("expected backlog data")
	}
	if len(backlog) > shellOutputBacklogMaxBytes {
		t.Fatalf("expected bounded backlog <= %d, got %d", shellOutputBacklogMaxBytes, len(backlog))
	}
	if strings.Contains(backlog, "[000]") {
		t.Fatalf("expected oldest chunks to be evicted")
	}
	if !strings.Contains(backlog, "[099]") {
		t.Fatalf("expected newest chunk to be retained")
	}
}

func TestGetShellSessionBacklog(t *testing.T) {
	app := newTestAppWithDefaults(t)
	sess := &shellSession{id: "s1"}
	sess.appendBacklog("line-1\n")
	sess.appendBacklog("line-2\n")
	app.shellSessions = map[string]*shellSession{
		"s1": sess,
	}

	backlog, err := app.GetShellSessionBacklog("s1")
	if err != nil {
		t.Fatalf("GetShellSessionBacklog error: %v", err)
	}
	if backlog != "line-1\nline-2\n" {
		t.Fatalf("unexpected backlog: %q", backlog)
	}

	if _, err := app.GetShellSessionBacklog("missing"); err == nil {
		t.Fatalf("expected error for missing shell session")
	}
}

func TestStartShellSessionValidation(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	// missing client should fail fast
	if _, err := app.StartShellSession(shellClusterID, ShellSessionRequest{}); err == nil {
		t.Fatal("expected error when client is nil")
	}

	// Per-cluster clients are stored in clusterClients, not in global fields.
	fakeClient := fake.NewClientset()
	restConfig := &rest.Config{}
	app.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	if _, err := app.StartShellSession(shellClusterID, ShellSessionRequest{}); err == nil {
		t.Fatal("expected namespace validation error")
	}
	if _, err := app.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "ns"}); err == nil {
		t.Fatal("expected pod name validation error")
	}
}

func TestStartShellSessionPodValidation(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Per-cluster clients are stored in clusterClients, not in global fields.
	restConfig := &rest.Config{}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
		Spec:       corev1.PodSpec{}, // no containers
	}
	fakeClient := fake.NewClientset(pod)
	app.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	_, err := app.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default", PodName: "pod-1"})
	if err == nil {
		t.Fatal("expected error when pod has no containers")
	}

	pod.Spec.Containers = []corev1.Container{{Name: "main"}}
	fakeClient = fake.NewClientset(pod)
	app.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	if _, err := app.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default", PodName: "pod-1", Container: "missing"}); err == nil {
		t.Fatal("expected error for missing container")
	}
}
