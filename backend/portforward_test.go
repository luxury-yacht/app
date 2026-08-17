package backend

import (
	"context"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

const portForwardClusterID = "config:ctx"

func TestStartPortForward_InvalidCluster(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.ClusterRuntime.clusterClients = make(map[string]*clusterClients)

	// Test with empty cluster ID.
	_, err := operations.startPortForwardAction(objectActionTarget("", "", "", "", "", ""), ObjectActionPortForwardOptions{})
	if err == nil {
		t.Fatal("expected error for empty cluster ID")
	}

	// Test with nonexistent cluster.
	_, err = operations.startPortForwardAction(objectActionTarget("nonexistent", "", "", "", "", ""), ObjectActionPortForwardOptions{})
	if err == nil {
		t.Fatal("expected error for nonexistent cluster")
	}
}

func TestStartPortForward_MissingClient(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Create a cluster entry WITHOUT a client to test the error path.
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			// client is nil
		},
	}

	_, err := operations.startPortForwardAction(
		objectActionTarget(portForwardClusterID, "", "v1", "Pod", "default", "test-pod"),
		ObjectActionPortForwardOptions{ContainerPort: 8080},
	)
	if err == nil {
		t.Fatal("expected error when client is nil")
	}
}

func TestStartPortForward_MissingRestConfig(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	fakeClient := fake.NewClientset()
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			// restConfig is nil
		},
	}

	_, err := operations.startPortForwardAction(
		objectActionTarget(portForwardClusterID, "", "v1", "Pod", "default", "test-pod"),
		ObjectActionPortForwardOptions{ContainerPort: 8080},
	)
	if err == nil {
		t.Fatal("expected error when rest config is nil")
	}
}

func TestStartPortForward_ValidationErrors(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	fakeClient := fake.NewClientset()
	restConfig := &rest.Config{}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	// Missing namespace.
	_, err := operations.startPortForwardAction(
		objectActionTarget(portForwardClusterID, "", "v1", "Pod", "", "test-pod"),
		ObjectActionPortForwardOptions{ContainerPort: 8080},
	)
	if err == nil {
		t.Fatal("expected error for missing namespace")
	}

	// Missing target name.
	_, err = operations.startPortForwardAction(
		objectActionTarget(portForwardClusterID, "", "v1", "Pod", "default", ""),
		ObjectActionPortForwardOptions{ContainerPort: 8080},
	)
	if err == nil {
		t.Fatal("expected error for missing target name")
	}

	// Invalid container port.
	_, err = operations.startPortForwardAction(
		objectActionTarget(portForwardClusterID, "", "v1", "Pod", "default", "test-pod"),
		ObjectActionPortForwardOptions{},
	)
	if err == nil {
		t.Fatal("expected error for invalid container port")
	}
}

func TestStartPortForwardRequiresPortForwardPermission(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "pod-1"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{{
				Type:   corev1.PodReady,
				Status: corev1.ConditionTrue,
			}},
		},
	}
	fakeClient := fake.NewClientset(pod)
	denySelfSubjectAccessReviews(fakeClient, "portforward denied")
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        &rest.Config{},
		},
	}

	_, err := operations.startPortForwardAction(
		objectActionTarget(portForwardClusterID, "", "v1", "Pod", "default", "pod-1"),
		ObjectActionPortForwardOptions{ContainerPort: 8080},
	)
	if err == nil || !strings.Contains(err.Error(), "portforward denied") {
		t.Fatalf("expected port-forward permission denial, got %v", err)
	}
	if len(operations.ListPortForwards()) != 0 {
		t.Fatalf("expected denied port forward not to be registered")
	}
}

func TestListPortForwards_Empty(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	sessions := operations.ListPortForwards()
	if len(sessions) != 0 {
		t.Fatalf("expected empty list, got %d sessions", len(sessions))
	}
}

func TestListPortForwards_ReturnsSessions(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Add some test sessions.
	now := time.Now()
	session1 := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "session-1",
			ClusterID:     "cluster-1",
			ClusterName:   "Cluster 1",
			Namespace:     "default",
			PodName:       "pod-1",
			ContainerPort: 8080,
			LocalPort:     9000,
			TargetKind:    "Pod",
			TargetName:    "pod-1",
			Status:        "active",
			StartedAt:     now.Add(-2 * time.Minute).Format(time.RFC3339),
		},
		stopChan: make(chan struct{}),
	}
	session2 := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "session-2",
			ClusterID:     "cluster-1",
			ClusterName:   "Cluster 1",
			Namespace:     "default",
			PodName:       "pod-2",
			ContainerPort: 3000,
			LocalPort:     9001,
			TargetKind:    "Deployment",
			TargetName:    "web-app",
			Status:        "active",
			StartedAt:     now.Add(-1 * time.Minute).Format(time.RFC3339),
		},
		stopChan: make(chan struct{}),
	}

	operations.portForwardSessions["session-1"] = session1
	operations.portForwardSessions["session-2"] = session2

	sessions := operations.ListPortForwards()
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}

	// Verify sorted by start time (oldest first).
	if sessions[0].ID != "session-1" {
		t.Fatalf("expected session-1 first (older), got %s", sessions[0].ID)
	}
	if sessions[1].ID != "session-2" {
		t.Fatalf("expected session-2 second (newer), got %s", sessions[1].ID)
	}
}

func TestStopPortForward_NotFound(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {}

	err := operations.StopPortForward("nonexistent-session")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

func TestStopPortForward_Success(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	var statusEvents []PortForwardStatusEvent
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == portForwardStatusEventName && len(args) == 1 {
			if ev, ok := args[0].(PortForwardStatusEvent); ok {
				statusEvents = append(statusEvents, ev)
			}
		}
	}

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "session-1",
			ClusterID:     "cluster-1",
			ClusterName:   "Cluster 1",
			Namespace:     "default",
			PodName:       "pod-1",
			ContainerPort: 8080,
			LocalPort:     9000,
			TargetKind:    "Pod",
			TargetName:    "pod-1",
			Status:        "active",
			StartedAt:     time.Now().Format(time.RFC3339),
		},
		stopChan: make(chan struct{}),
	}
	operations.portForwardSessions["session-1"] = session

	err := operations.StopPortForward("session-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify session was removed.
	if _, exists := operations.portForwardSessions["session-1"]; exists {
		t.Fatal("expected session to be removed")
	}

	// Verify status event was emitted.
	if len(statusEvents) != 1 {
		t.Fatalf("expected 1 status event, got %d", len(statusEvents))
	}
	if statusEvents[0].Status != "stopped" {
		t.Fatalf("expected stopped status, got %s", statusEvents[0].Status)
	}
}

func TestPortForwardLifecycleFinishTerminalIsIdempotent(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	portForwardListEvents := 0
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		if name == portForwardListEventName {
			portForwardListEvents++
		}
	}

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "session-terminal-cleanup",
			ClusterID:     "cluster-1",
			ClusterName:   "Cluster 1",
			Namespace:     "default",
			PodName:       "pod-1",
			ContainerPort: 8080,
			LocalPort:     9000,
			TargetKind:    "Pod",
			TargetVersion: "v1",
			TargetName:    "pod-1",
			Status:        "active",
			StartedAt:     time.Now().Format(time.RFC3339),
		},
		stopChan: make(chan struct{}),
	}
	operations.portForwardSessions[session.ID] = session
	operations.registerRuntimeOperation(runtimeOperationFromPortForward(session), nil)
	portForwardListEvents = 0

	lifecycle := operations.portForwardLifecycle()
	if removed := lifecycle.finishTerminal(session.ID); !removed {
		t.Fatal("expected first terminal cleanup to remove session")
	}
	if removed := lifecycle.finishTerminal(session.ID); removed {
		t.Fatal("expected second terminal cleanup to be a no-op")
	}

	if got := lifecycle.get(session.ID); got != nil {
		t.Fatal("expected terminal cleanup to remove session")
	}
	if operationList := operations.ListRuntimeOperations(); len(operationList) != 0 {
		t.Fatalf("expected terminal cleanup to unregister runtime operation, got %+v", operationList)
	}
	if portForwardListEvents != 1 {
		t.Fatalf("expected one port-forward list event, got %d", portForwardListEvents)
	}
}

func TestPortForwardLifecycleStopForRuntimeIsIdempotent(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	var statusEvents []PortForwardStatusEvent
	portForwardListEvents := 0
	app.Lifecycle.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		switch name {
		case portForwardStatusEventName:
			if len(args) == 1 {
				if ev, ok := args[0].(PortForwardStatusEvent); ok {
					statusEvents = append(statusEvents, ev)
				}
			}
		case portForwardListEventName:
			portForwardListEvents++
		}
	}

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:        "session-runtime-cleanup",
			ClusterID: "cluster-1",
			Status:    "active",
		},
		stopChan: make(chan struct{}),
	}
	operations.portForwardSessions[session.ID] = session

	if err := operations.portForwardLifecycle().stopForRuntime(session.ID, "cluster disconnected"); err != nil {
		t.Fatalf("unexpected cleanup error: %v", err)
	}
	if err := operations.portForwardLifecycle().stopForRuntime(session.ID, "cluster disconnected"); err != nil {
		t.Fatalf("expected repeated runtime cleanup to be ignored, got %v", err)
	}

	if got := operations.portForwardLifecycle().get(session.ID); got != nil {
		t.Fatal("expected runtime cleanup to remove session")
	}
	if len(statusEvents) != 1 {
		t.Fatalf("expected one status event, got %d", len(statusEvents))
	}
	if statusEvents[0].Status != "stopped" {
		t.Fatalf("expected stopped status, got %s", statusEvents[0].Status)
	}
	if statusEvents[0].StatusReason != "cluster disconnected" {
		t.Fatalf("expected cluster disconnected reason, got %q", statusEvents[0].StatusReason)
	}
	if portForwardListEvents != 0 {
		t.Fatalf("expected runtime callback to defer list publication to StopCluster, got %d", portForwardListEvents)
	}
}

func TestRunPortForwarderUnregistersRuntimeOperationOnTerminalError(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.ClusterRuntime.clusterClients = make(map[string]*clusterClients)
	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {}

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "session-terminal-error",
			ClusterID:     "missing-cluster",
			Namespace:     "default",
			PodName:       "pod-1",
			ContainerPort: 8080,
			LocalPort:     9000,
			TargetKind:    "Pod",
			TargetVersion: "v1",
			TargetName:    "pod-1",
			Status:        "active",
			StartedAt:     time.Now().Format(time.RFC3339),
		},
		stopChan:  make(chan struct{}),
		readyChan: make(chan error, 1),
	}
	operations.portForwardSessions[session.ID] = session
	operations.registerRuntimeOperation(runtimeOperationFromPortForward(session), nil)

	operations.runPortForwarder(context.Background(), session)

	if operationList := operations.ListRuntimeOperations(); len(operationList) != 0 {
		t.Fatalf("expected runtime operation to be removed, got %+v", operationList)
	}
	if _, exists := operations.portForwardSessions[session.ID]; exists {
		t.Fatal("expected terminal port forward session to be removed")
	}
}

func TestOperationsCoordinatorStopClusterCleansPortForwards(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {}

	// Add sessions for two clusters.
	session1 := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:        "session-1",
			ClusterID: "cluster-1",
			Status:    "active",
		},
		stopChan: make(chan struct{}),
	}
	session2 := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:        "session-2",
			ClusterID: "cluster-1",
			Status:    "active",
		},
		stopChan: make(chan struct{}),
	}
	session3 := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:        "session-3",
			ClusterID: "cluster-2",
			Status:    "active",
		},
		stopChan: make(chan struct{}),
	}

	operations.portForwardSessions["session-1"] = session1
	operations.portForwardSessions["session-2"] = session2
	operations.portForwardSessions["session-3"] = session3
	for _, session := range []*portForwardSessionInternal{session1, session2, session3} {
		sessionID := session.ID
		operations.registerRuntimeOperation(runtimeOperationFromPortForward(session), func(reason string) error {
			return operations.portForwardLifecycle().stopForRuntime(sessionID, reason)
		})
	}

	// Stop all forwards for cluster-1.
	operations.StopCluster("cluster-1")

	// Verify cluster-1 sessions were removed.
	if _, exists := operations.portForwardSessions["session-1"]; exists {
		t.Fatal("expected session-1 to be removed")
	}
	if _, exists := operations.portForwardSessions["session-2"]; exists {
		t.Fatal("expected session-2 to be removed")
	}

	// Verify cluster-2 session remains.
	if _, exists := operations.portForwardSessions["session-3"]; !exists {
		t.Fatal("expected session-3 to remain")
	}
	remainingOperations := operations.ListRuntimeOperations()
	if len(remainingOperations) != 1 {
		t.Fatalf("expected one runtime operation to remain, got %+v", remainingOperations)
	}
	if remainingOperations[0].ID != "session-3" {
		t.Fatalf("expected session-3 runtime operation to remain, got %+v", remainingOperations)
	}
}

func TestGetClusterPortForwardCount(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Empty initially.
	if count := operations.GetClusterPortForwardCount("cluster-1"); count != 0 {
		t.Fatalf("expected 0, got %d", count)
	}

	// Add sessions.
	operations.portForwardSessions["session-1"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ClusterID: "cluster-1"},
	}
	operations.portForwardSessions["session-2"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ClusterID: "cluster-1"},
	}
	operations.portForwardSessions["session-3"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ClusterID: "cluster-2"},
	}

	if count := operations.GetClusterPortForwardCount("cluster-1"); count != 2 {
		t.Fatalf("expected 2, got %d", count)
	}
	if count := operations.GetClusterPortForwardCount("cluster-2"); count != 1 {
		t.Fatalf("expected 1, got %d", count)
	}
	if count := operations.GetClusterPortForwardCount("cluster-3"); count != 0 {
		t.Fatalf("expected 0, got %d", count)
	}
}

func TestCalculateBackoff(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator

	tests := []struct {
		attempt  int
		expected time.Duration
	}{
		{1, 1 * time.Second},
		{2, 2 * time.Second},
		{3, 4 * time.Second},
		{4, 8 * time.Second},
		{5, 16 * time.Second},
		{6, 30 * time.Second}, // capped at max
		{7, 30 * time.Second}, // stays at max
	}

	for _, tc := range tests {
		got := operations.calculateBackoff(tc.attempt)
		if got != tc.expected {
			t.Errorf("attempt %d: expected %v, got %v", tc.attempt, tc.expected, got)
		}
	}
}

func TestShouldReconnect(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator

	tests := []struct {
		targetKind string
		expected   bool
	}{
		{"Pod", false},
		{"Deployment", true},
		{"StatefulSet", true},
		{"DaemonSet", true},
		{"Service", true},
		{"Unknown", false},
	}

	for _, tc := range tests {
		session := &portForwardSessionInternal{
			PortForwardSession: PortForwardSession{
				TargetKind: tc.targetKind,
			},
		}
		got := operations.shouldReconnect(session)
		if got != tc.expected {
			t.Errorf("targetKind %s: expected %v, got %v", tc.targetKind, tc.expected, got)
		}
	}
}

func TestPortForwardSessionClose(t *testing.T) {
	stopChan := make(chan struct{})
	cancelCalled := false
	session := &portForwardSessionInternal{
		stopChan: stopChan,
		cancel:   func() { cancelCalled = true },
	}

	// First close should work.
	session.close()

	// Verify stop channel is closed.
	select {
	case <-stopChan:
		// Expected.
	default:
		t.Fatal("expected stop channel to be closed")
	}

	if !cancelCalled {
		t.Fatal("expected cancel function to be called")
	}

	// Second close should be safe (no panic).
	session.close()
}

func TestValidatePortForwardURL(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator

	tests := []struct {
		url    string
		valid  bool
		errMsg string
	}{
		{"http://localhost:8080", true, ""},
		{"https://example.com/path", true, ""},
		{"", false, "URL is required"},
		{"ftp://files.example.com", false, "only http and https URLs are allowed"},
		{"://invalid", false, "invalid URL"},
		{"http://", false, "URL must have a host"},
	}

	for _, tc := range tests {
		valid, errMsg := operations.ValidatePortForwardURL(tc.url)
		if valid != tc.valid {
			t.Errorf("url %q: expected valid=%v, got %v", tc.url, tc.valid, valid)
		}
		// Use prefix match for error messages since some include additional details.
		if tc.errMsg != "" && !strings.HasPrefix(errMsg, tc.errMsg) {
			t.Errorf("url %q: expected error starting with %q, got %q", tc.url, tc.errMsg, errMsg)
		}
	}
}

func TestEmitPortForwardStatusGuards(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	calls := 0
	app.Lifecycle.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {
		calls++
	}

	// Nil session should not emit.
	operations.portForwardLifecycle().emitStatus(nil)
	if calls != 0 {
		t.Fatalf("expected no events for nil session, got %d", calls)
	}
}

func TestPortForwardLifecycleRemoveAndGetSession(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator
	operations.portForwardSessions = make(map[string]*portForwardSessionInternal)
	lifecycle := operations.portForwardLifecycle()

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:        "session-1",
			ClusterID: "cluster-1",
		},
	}
	operations.portForwardSessions["session-1"] = session

	// Get existing session.
	got := lifecycle.get("session-1")
	if got == nil || got.ID != "session-1" {
		t.Fatal("expected to get session-1")
	}

	// Get nonexistent session.
	if got := lifecycle.get("nonexistent"); got != nil {
		t.Fatal("expected nil for nonexistent session")
	}

	// Remove existing session.
	removed, ok := lifecycle.remove("session-1")
	if removed == nil || removed.ID != "session-1" {
		t.Fatal("expected to remove session-1")
	}
	if !ok {
		t.Fatal("expected remove to report session-1 existed")
	}

	// Verify it's gone.
	if got := lifecycle.get("session-1"); got != nil {
		t.Fatal("expected session-1 to be removed")
	}

	// Remove nonexistent session.
	if removed, ok := lifecycle.remove("nonexistent"); removed != nil || ok {
		t.Fatal("expected nil for removing nonexistent session")
	}
}
