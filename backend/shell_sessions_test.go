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
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	events := make([]ShellOutputEvent, 0, 1)
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == shellOutputEventName && len(args) == 1 {
			if ev, ok := args[0].(ShellOutputEvent); ok {
				events = append(events, ev)
			}
		}
	}

	sess := &shellSession{}
	writer := &shellEventWriter{
		coordinator: operations, sessionID: "s1", clusterID: "cluster1", stream: "stdout", session: sess,
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
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.shellSessions = make(map[string]*shellSession)

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
	operations.shellSessions["sess"] = sess

	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {}

	readCh := make(chan string, 1)
	go func() {
		buf := make([]byte, 4)
		n, _ := stdinR.Read(buf)
		readCh <- string(buf[:n])
	}()

	if err := operations.SendShellInput("sess", "data"); err != nil {
		t.Fatalf("SendShellInput error: %v", err)
	}
	if got := <-readCh; got != "data" {
		t.Fatalf("stdin read mismatch: %q", got)
	}

	if err := operations.ResizeShellSession("sess", 120, 50); err != nil {
		t.Fatalf("ResizeShellSession error: %v", err)
	}
	s := sizeQueue.Next()
	if s == nil || s.Width != 120 || s.Height != 50 {
		t.Fatalf("unexpected size after resize %#v", s)
	}

	events := make([]ShellStatusEvent, 0, 1)
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == shellStatusEventName && len(args) == 1 {
			if ev, ok := args[0].(ShellStatusEvent); ok {
				events = append(events, ev)
			}
		}
	}
	if err := operations.CloseShellSession("sess"); err != nil {
		t.Fatalf("CloseShellSession error: %v", err)
	}
	if operations.shellSessionLifecycle().get("sess") != nil {
		t.Fatalf("expected session to be removed")
	}
	if len(events) != 1 || events[0].Status != "closed" || events[0].ClusterID != "cluster1" {
		t.Fatalf("unexpected status events %+v", events)
	}
}

func TestTerminateShellWithReasonUnregistersRuntimeOperation(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.shellSessions = make(map[string]*shellSession)

	sess := &shellSession{
		id:        "sess",
		clusterID: "cluster1",
		namespace: "default",
		podName:   "pod-a",
		container: "app",
		command:   []string{"/bin/sh"},
		startedAt: time.Now(),
	}
	operations.shellSessions[sess.id] = sess
	operations.registerRuntimeOperation(runtimeOperationFromShellSession(sess), nil)

	if operationList := operations.ListRuntimeOperations(); len(operationList) != 1 {
		t.Fatalf("expected registered runtime operation, got %+v", operationList)
	}

	operations.terminateShellWithReason(sess.id, "timeout", "session idle timeout")

	if operations.shellSessionLifecycle().get(sess.id) != nil {
		t.Fatalf("expected session to be removed")
	}
	if operationList := operations.ListRuntimeOperations(); len(operationList) != 0 {
		t.Fatalf("expected runtime operation to be unregistered, got %+v", operationList)
	}
}

func TestShellSessionLifecycleFinishStreamIsIdempotent(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.shellSessions = make(map[string]*shellSession)

	var statusEvents []ShellStatusEvent
	listEvents := 0
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		switch name {
		case shellStatusEventName:
			if len(args) == 1 {
				if ev, ok := args[0].(ShellStatusEvent); ok {
					statusEvents = append(statusEvents, ev)
				}
			}
		case shellListEventName:
			listEvents++
		}
	}

	sess := &shellSession{
		id:        "sess-stream",
		clusterID: "cluster1",
		namespace: "default",
		podName:   "pod-a",
		container: "app",
		command:   []string{"/bin/sh"},
		startedAt: time.Now(),
	}
	operations.shellSessions[sess.id] = sess
	operations.registerRuntimeOperation(runtimeOperationFromShellSession(sess), nil)
	listEvents = 0

	lifecycle := operations.shellSessionLifecycle()
	if finished := lifecycle.finishStream(sess.id, "closed", ""); !finished {
		t.Fatal("expected first stream finish to remove session")
	}
	if finished := lifecycle.finishStream(sess.id, "closed", ""); finished {
		t.Fatal("expected repeated stream finish to be ignored")
	}

	if lifecycle.get(sess.id) != nil {
		t.Fatal("expected stream finish to remove session")
	}
	if operationList := operations.ListRuntimeOperations(); len(operationList) != 0 {
		t.Fatalf("expected stream finish to unregister runtime operation, got %+v", operationList)
	}
	if len(statusEvents) != 1 {
		t.Fatalf("expected one status event, got %d", len(statusEvents))
	}
	if statusEvents[0].Status != "closed" || statusEvents[0].ClusterID != "cluster1" {
		t.Fatalf("unexpected status event %+v", statusEvents[0])
	}
	if listEvents != 1 {
		t.Fatalf("expected one list event, got %d", listEvents)
	}
}

func TestShellSessionLifecycleCloseForRuntimeIsIdempotent(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.shellSessions = make(map[string]*shellSession)

	var statusEvents []ShellStatusEvent
	listEvents := 0
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		switch name {
		case shellStatusEventName:
			if len(args) == 1 {
				if ev, ok := args[0].(ShellStatusEvent); ok {
					statusEvents = append(statusEvents, ev)
				}
			}
		case shellListEventName:
			listEvents++
		}
	}

	sess := &shellSession{id: "sess-runtime", clusterID: "cluster1"}
	operations.shellSessions[sess.id] = sess

	if err := operations.shellSessionLifecycle().closeForRuntime(sess.id, "cluster disconnected"); err != nil {
		t.Fatalf("unexpected cleanup error: %v", err)
	}
	if err := operations.shellSessionLifecycle().closeForRuntime(sess.id, "cluster disconnected"); err != nil {
		t.Fatalf("expected repeated runtime cleanup to be ignored, got %v", err)
	}

	if operations.shellSessionLifecycle().get(sess.id) != nil {
		t.Fatal("expected runtime cleanup to remove session")
	}
	if len(statusEvents) != 1 {
		t.Fatalf("expected one status event, got %d", len(statusEvents))
	}
	if statusEvents[0].Status != "closed" || statusEvents[0].Reason != "cluster disconnected" {
		t.Fatalf("unexpected status event %+v", statusEvents[0])
	}
	if listEvents != 0 {
		t.Fatalf("expected runtime callback to defer list publication to StopCluster, got %d", listEvents)
	}
}

func TestShellSessionMissingGuards(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	if err := operations.SendShellInput("missing", "x"); err == nil {
		t.Fatalf("expected error for missing session")
	}
	if err := operations.ResizeShellSession("missing", -1, 0); err == nil {
		t.Fatalf("expected error for invalid resize")
	}
	if err := operations.CloseShellSession("missing"); err == nil {
		t.Fatalf("expected error for missing session close")
	}
}

func TestResizeShellSessionRejectsOverflowDimensions(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	operations.shellSessions = map[string]*shellSession{
		"sess": {
			id:        "sess",
			sizeQueue: newTerminalSizeQueue(),
		},
	}

	if err := operations.ResizeShellSession("sess", maxTerminalDimension+1, 24); err == nil {
		t.Fatalf("expected oversized columns to be rejected")
	}
	if err := operations.ResizeShellSession("sess", 80, maxTerminalDimension+1); err == nil {
		t.Fatalf("expected oversized rows to be rejected")
	}
}

func TestListShellSessionsAndClusterCount(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	now := time.Now()
	operations.shellSessions = map[string]*shellSession{
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

	sessions := operations.ListShellSessions()
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	if sessions[0].SessionID != "s1" || sessions[1].SessionID != "s2" {
		t.Fatalf("expected sessions sorted by startedAt, got %+v", sessions)
	}
	if sessions[0].ClusterName != "cluster-a-name" {
		t.Fatalf("unexpected cluster name: %+v", sessions[0])
	}
	if count := operations.GetClusterShellSessionCount("cluster-a"); count != 1 {
		t.Fatalf("expected cluster-a count 1, got %d", count)
	}
	if count := operations.GetClusterShellSessionCount("cluster-b"); count != 1 {
		t.Fatalf("expected cluster-b count 1, got %d", count)
	}
}

func TestOperationsCoordinatorStopClusterCleansShellSessions(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.shellSessions = map[string]*shellSession{
		"s1": {
			id:        "s1",
			clusterID: "cluster-a",
			namespace: "default",
			podName:   "pod-a",
			container: "app",
			command:   []string{"/bin/sh"},
			startedAt: time.Now().Add(-3 * time.Minute),
		},
		"s2": {
			id:        "s2",
			clusterID: "cluster-a",
			namespace: "default",
			podName:   "pod-b",
			container: "app",
			command:   []string{"/bin/sh"},
			startedAt: time.Now().Add(-2 * time.Minute),
		},
		"s3": {
			id:        "s3",
			clusterID: "cluster-b",
			namespace: "default",
			podName:   "pod-c",
			container: "app",
			command:   []string{"/bin/sh"},
			startedAt: time.Now().Add(-1 * time.Minute),
		},
	}
	for _, sessionID := range []string{"s1", "s2", "s3"} {
		sessionID := sessionID
		operations.registerRuntimeOperation(runtimeOperationFromShellSession(operations.shellSessions[sessionID]), func(reason string) error {
			return operations.shellSessionLifecycle().closeForRuntime(sessionID, reason)
		})
	}

	statusEvents := make([]ShellStatusEvent, 0)
	listEvents := make([][]ShellSessionInfo, 0)
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
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

	operations.StopCluster("cluster-a")
	if operations.shellSessionLifecycle().get("s1") != nil || operations.shellSessionLifecycle().get("s2") != nil {
		t.Fatalf("expected cluster-a sessions removed")
	}
	if operations.shellSessionLifecycle().get("s3") == nil {
		t.Fatalf("expected cluster-b session to remain")
	}
	remainingOperations := operations.ListRuntimeOperations()
	if len(remainingOperations) != 1 {
		t.Fatalf("expected one runtime operation to remain, got %+v", remainingOperations)
	}
	if remainingOperations[0].ID != "s3" {
		t.Fatalf("expected s3 runtime operation to remain, got %+v", remainingOperations)
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
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	calls := 0
	app.Lifecycle.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {
		calls++
	}

	// guard cases
	operations.shellSessionLifecycle().emitOutput("", "cluster1", "stdout", "data")
	operations.shellSessionLifecycle().emitOutput("id", "cluster1", "stdout", "")
	operations.shellSessionLifecycle().emitStatus("", "cluster1", "open", "")
	operations.shellSessionLifecycle().emitStatus("id", "cluster1", "", "")
	if calls != 0 {
		t.Fatalf("expected no events for guarded inputs, got %d", calls)
	}

	// happy paths
	operations.shellSessionLifecycle().emitOutput("id", "cluster1", "stdout", "line")
	operations.shellSessionLifecycle().emitStatus("id", "cluster1", "open", "reason")
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
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	sess := &shellSession{id: "s1"}
	sess.appendBacklog("line-1\n")
	sess.appendBacklog("line-2\n")
	operations.shellSessions = map[string]*shellSession{
		"s1": sess,
	}

	backlog, err := operations.GetShellSessionBacklog("s1")
	if err != nil {
		t.Fatalf("GetShellSessionBacklog error: %v", err)
	}
	if backlog != "line-1\nline-2\n" {
		t.Fatalf("unexpected backlog: %q", backlog)
	}

	if _, err := operations.GetShellSessionBacklog("missing"); err == nil {
		t.Fatalf("expected error for missing shell session")
	}
}

func TestStartShellSessionValidation(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	// missing client should fail fast
	if _, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{}); err == nil {
		t.Fatal("expected error when client is nil")
	}

	// Per-cluster clients are stored in clusterClients, not in global fields.
	fakeClient := fake.NewClientset()
	restConfig := &rest.Config{}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	if _, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{}); err == nil {
		t.Fatal("expected namespace validation error")
	}
	if _, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "ns"}); err == nil {
		t.Fatal("expected pod name validation error")
	}
}

func TestStartShellSessionPodValidation(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// Per-cluster clients are stored in clusterClients, not in global fields.
	restConfig := &rest.Config{}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
		Spec:       corev1.PodSpec{}, // no containers
	}
	fakeClient := fake.NewClientset(pod)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	_, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default", PodName: "pod-1"})
	if err == nil {
		t.Fatal("expected error when pod has no containers")
	}

	pod.Spec.Containers = []corev1.Container{{Name: "main"}}
	fakeClient = fake.NewClientset(pod)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	if _, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default", PodName: "pod-1", Container: "missing"}); err == nil {
		t.Fatal("expected error for missing container")
	}
}

func TestStartShellSessionRequiresExecPermission(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main"}},
		},
	}
	fakeClient := fake.NewClientset(pod)
	denySelfSubjectAccessReviews(fakeClient, "exec denied")

	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        &rest.Config{},
		},
	}

	_, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{
		Namespace: "default",
		PodName:   "pod-1",
		Container: "main",
	})
	if err == nil || !strings.Contains(err.Error(), "exec denied") {
		t.Fatalf("expected exec permission denial, got %v", err)
	}
	if len(operations.ListShellSessions()) != 0 {
		t.Fatalf("expected denied shell session not to be registered")
	}
}
