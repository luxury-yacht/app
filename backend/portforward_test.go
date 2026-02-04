package backend

import (
	"context"
	"strings"
	"testing"
	"time"

	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

const portForwardClusterID = "config:ctx"

func TestStartPortForward_InvalidCluster(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.clusterClients = make(map[string]*clusterClients)

	// Test with empty cluster ID.
	_, err := app.StartPortForward("", PortForwardRequest{})
	if err == nil {
		t.Fatal("expected error for empty cluster ID")
	}

	// Test with nonexistent cluster.
	_, err = app.StartPortForward("nonexistent", PortForwardRequest{})
	if err == nil {
		t.Fatal("expected error for nonexistent cluster")
	}
}

func TestStartPortForward_MissingClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Create a cluster entry WITHOUT a client to test the error path.
	app.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			// client is nil
		},
	}

	_, err := app.StartPortForward(portForwardClusterID, PortForwardRequest{})
	if err == nil {
		t.Fatal("expected error when client is nil")
	}
}

func TestStartPortForward_MissingRestConfig(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	fakeClient := fake.NewClientset()
	app.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			// restConfig is nil
		},
	}

	_, err := app.StartPortForward(portForwardClusterID, PortForwardRequest{
		Namespace:     "default",
		TargetKind:    "Pod",
		TargetName:    "test-pod",
		ContainerPort: 8080,
	})
	if err == nil {
		t.Fatal("expected error when rest config is nil")
	}
}

func TestStartPortForward_ValidationErrors(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	fakeClient := fake.NewClientset()
	restConfig := &rest.Config{}
	app.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	// Missing namespace.
	_, err := app.StartPortForward(portForwardClusterID, PortForwardRequest{
		TargetKind:    "Pod",
		TargetName:    "test-pod",
		ContainerPort: 8080,
	})
	if err == nil {
		t.Fatal("expected error for missing namespace")
	}

	// Missing target name.
	_, err = app.StartPortForward(portForwardClusterID, PortForwardRequest{
		Namespace:     "default",
		TargetKind:    "Pod",
		ContainerPort: 8080,
	})
	if err == nil {
		t.Fatal("expected error for missing target name")
	}

	// Invalid container port.
	_, err = app.StartPortForward(portForwardClusterID, PortForwardRequest{
		Namespace:     "default",
		TargetKind:    "Pod",
		TargetName:    "test-pod",
		ContainerPort: 0,
	})
	if err == nil {
		t.Fatal("expected error for invalid container port")
	}
}

func TestListPortForwards_Empty(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	sessions := app.ListPortForwards()
	if len(sessions) != 0 {
		t.Fatalf("expected empty list, got %d sessions", len(sessions))
	}
}

func TestListPortForwards_ReturnsSessions(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

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
			StartedAt:     now.Add(-2 * time.Minute),
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
			StartedAt:     now.Add(-1 * time.Minute),
		},
		stopChan: make(chan struct{}),
	}

	app.portForwardSessions["session-1"] = session1
	app.portForwardSessions["session-2"] = session2

	sessions := app.ListPortForwards()
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
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.eventEmitter = func(context.Context, string, ...interface{}) {}

	err := app.StopPortForward("nonexistent-session")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

func TestStopPortForward_Success(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	var statusEvents []PortForwardStatusEvent
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
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
			StartedAt:     time.Now(),
		},
		stopChan: make(chan struct{}),
	}
	app.portForwardSessions["session-1"] = session

	err := app.StopPortForward("session-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify session was removed.
	if _, exists := app.portForwardSessions["session-1"]; exists {
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

func TestStopClusterPortForwards(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)
	app.eventEmitter = func(context.Context, string, ...interface{}) {}

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

	app.portForwardSessions["session-1"] = session1
	app.portForwardSessions["session-2"] = session2
	app.portForwardSessions["session-3"] = session3

	// Stop all forwards for cluster-1.
	err := app.StopClusterPortForwards("cluster-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify cluster-1 sessions were removed.
	if _, exists := app.portForwardSessions["session-1"]; exists {
		t.Fatal("expected session-1 to be removed")
	}
	if _, exists := app.portForwardSessions["session-2"]; exists {
		t.Fatal("expected session-2 to be removed")
	}

	// Verify cluster-2 session remains.
	if _, exists := app.portForwardSessions["session-3"]; !exists {
		t.Fatal("expected session-3 to remain")
	}
}

func TestGetClusterPortForwardCount(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Empty initially.
	if count := app.GetClusterPortForwardCount("cluster-1"); count != 0 {
		t.Fatalf("expected 0, got %d", count)
	}

	// Add sessions.
	app.portForwardSessions["session-1"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ClusterID: "cluster-1"},
	}
	app.portForwardSessions["session-2"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ClusterID: "cluster-1"},
	}
	app.portForwardSessions["session-3"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ClusterID: "cluster-2"},
	}

	if count := app.GetClusterPortForwardCount("cluster-1"); count != 2 {
		t.Fatalf("expected 2, got %d", count)
	}
	if count := app.GetClusterPortForwardCount("cluster-2"); count != 1 {
		t.Fatalf("expected 1, got %d", count)
	}
	if count := app.GetClusterPortForwardCount("cluster-3"); count != 0 {
		t.Fatalf("expected 0, got %d", count)
	}
}

func TestCalculateBackoff(t *testing.T) {
	app := newTestAppWithDefaults(t)

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
		got := app.calculateBackoff(tc.attempt)
		if got != tc.expected {
			t.Errorf("attempt %d: expected %v, got %v", tc.attempt, tc.expected, got)
		}
	}
}

func TestShouldReconnect(t *testing.T) {
	app := newTestAppWithDefaults(t)

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
		got := app.shouldReconnect(session)
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
	app := newTestAppWithDefaults(t)

	tests := []struct {
		url     string
		valid   bool
		errMsg  string
	}{
		{"http://localhost:8080", true, ""},
		{"https://example.com/path", true, ""},
		{"", false, "URL is required"},
		{"ftp://files.example.com", false, "only http and https URLs are allowed"},
		{"://invalid", false, "invalid URL"},
		{"http://", false, "URL must have a host"},
	}

	for _, tc := range tests {
		valid, errMsg := app.ValidatePortForwardURL(tc.url)
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
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	calls := 0
	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {
		calls++
	}

	// Nil session should not emit.
	app.emitPortForwardStatus(nil)
	if calls != 0 {
		t.Fatalf("expected no events for nil session, got %d", calls)
	}
}

func TestRemoveAndGetPortForwardSession(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:        "session-1",
			ClusterID: "cluster-1",
		},
	}
	app.portForwardSessions["session-1"] = session

	// Get existing session.
	got := app.getPortForwardSession("session-1")
	if got == nil || got.ID != "session-1" {
		t.Fatal("expected to get session-1")
	}

	// Get nonexistent session.
	if got := app.getPortForwardSession("nonexistent"); got != nil {
		t.Fatal("expected nil for nonexistent session")
	}

	// Remove existing session.
	removed := app.removePortForwardSession("session-1")
	if removed == nil || removed.ID != "session-1" {
		t.Fatal("expected to remove session-1")
	}

	// Verify it's gone.
	if got := app.getPortForwardSession("session-1"); got != nil {
		t.Fatal("expected session-1 to be removed")
	}

	// Remove nonexistent session.
	if removed := app.removePortForwardSession("nonexistent"); removed != nil {
		t.Fatal("expected nil for removing nonexistent session")
	}
}
