# Port Forwarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add port forwarding support for pods, services, and workloads across multiple clusters with a management panel.

**Architecture:** Backend manages port forward sessions (similar to shell_sessions.go pattern), emits status events. Frontend provides modal for configuration, dockable panel for management, and context menu integration.

**Tech Stack:** Go client-go portforward package, React, Wails events, existing DockablePanel/Modal patterns.

---

## Task 1: Backend Types and Session Structure

**Files:**
- Create: `backend/portforward_types.go`

**Step 1: Create the port forward types file**

```go
package backend

import (
	"context"
	"sync"
	"time"
)

const (
	portForwardStatusEventName = "portforward:status"
	portForwardListEventName   = "portforward:list"

	// Reconnect settings
	portForwardMaxReconnectAttempts = 5
	portForwardInitialBackoff       = 1 * time.Second
	portForwardMaxBackoff           = 30 * time.Second
)

// PortForwardSession represents an active port forwarding session.
type PortForwardSession struct {
	ID            string    `json:"id"`
	ClusterID     string    `json:"clusterId"`
	ClusterName   string    `json:"clusterName"`
	Namespace     string    `json:"namespace"`
	PodName       string    `json:"podName"`
	ContainerPort int       `json:"containerPort"`
	LocalPort     int       `json:"localPort"`
	TargetKind    string    `json:"targetKind"`
	TargetName    string    `json:"targetName"`
	Status        string    `json:"status"`
	StatusReason  string    `json:"statusReason,omitempty"`
	StartedAt     time.Time `json:"startedAt"`
}

// portForwardSessionInternal holds runtime state not exposed to frontend.
type portForwardSessionInternal struct {
	PortForwardSession
	stopChan         chan struct{}
	cancel           context.CancelFunc
	reconnectAttempt int
	mu               sync.Mutex
}

func (s *portForwardSessionInternal) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopChan != nil {
		select {
		case <-s.stopChan:
		default:
			close(s.stopChan)
		}
	}
	if s.cancel != nil {
		s.cancel()
	}
}

// PortForwardStatusEvent is emitted on status changes.
type PortForwardStatusEvent struct {
	SessionID    string `json:"sessionId"`
	ClusterID    string `json:"clusterId"`
	Status       string `json:"status"`
	StatusReason string `json:"statusReason,omitempty"`
	LocalPort    int    `json:"localPort,omitempty"`
	PodName      string `json:"podName,omitempty"`
}

// PortForwardRequest contains parameters for starting a port forward.
type PortForwardRequest struct {
	Namespace     string `json:"namespace"`
	TargetKind    string `json:"targetKind"`
	TargetName    string `json:"targetName"`
	ContainerPort int    `json:"containerPort"`
	LocalPort     int    `json:"localPort"`
}
```

**Step 2: Run tests to ensure no syntax errors**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add backend/portforward_types.go
git commit -m "feat(portforward): add type definitions for port forwarding sessions"
```

---

## Task 2: Add Port Forward Session Map to App

**Files:**
- Modify: `backend/app.go`

**Step 1: Add session map and mutex to App struct**

Find the `shellSessions` field in the App struct and add below it:

```go
	portForwardSessions   map[string]*portForwardSessionInternal
	portForwardSessionsMu sync.Mutex
```

**Step 2: Initialize the map in NewApp()**

Find `shellSessions: make(map[string]*shellSession),` and add below it:

```go
		portForwardSessions:  make(map[string]*portForwardSessionInternal),
```

**Step 3: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/... -count=1`
Expected: All tests pass

**Step 4: Commit**

```bash
git add backend/app.go
git commit -m "feat(portforward): add session storage to App struct"
```

---

## Task 3: Backend Pod Resolution Logic

**Files:**
- Create: `backend/portforward_resolve.go`
- Create: `backend/portforward_resolve_test.go`

**Step 1: Write the failing test**

```go
package backend

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestResolvePodForTarget_Pod(t *testing.T) {
	client := fake.NewSimpleClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue},
			},
		},
	})

	podName, err := resolvePodForTarget(context.Background(), client, "default", "Pod", "my-pod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "my-pod" {
		t.Errorf("expected pod name 'my-pod', got '%s'", podName)
	}
}

func TestResolvePodForTarget_Deployment(t *testing.T) {
	client := fake.NewSimpleClientset(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-abc123",
				Namespace: "default",
				Labels:    map[string]string{"app": "nginx"},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, "default", "Deployment", "nginx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "nginx-abc123" {
		t.Errorf("expected pod name 'nginx-abc123', got '%s'", podName)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/... -run TestResolvePodForTarget -v`
Expected: FAIL - function not defined

**Step 3: Write the implementation**

```go
package backend

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// resolvePodForTarget finds a ready pod for the given target resource.
// For Pods, returns the pod name directly.
// For Deployments/StatefulSets/DaemonSets, finds a ready pod with matching labels.
// For Services, finds a ready pod from the service's endpoints.
func resolvePodForTarget(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, targetKind, targetName string,
) (string, error) {
	switch targetKind {
	case "Pod":
		pod, err := client.CoreV1().Pods(namespace).Get(ctx, targetName, metav1.GetOptions{})
		if err != nil {
			return "", fmt.Errorf("failed to get pod: %w", err)
		}
		if !isPodReady(pod) {
			return "", fmt.Errorf("pod %s is not ready", targetName)
		}
		return targetName, nil

	case "Deployment", "StatefulSet", "DaemonSet":
		return findReadyPodForWorkload(ctx, client, namespace, targetKind, targetName)

	case "Service":
		return findReadyPodForService(ctx, client, namespace, targetName)

	default:
		return "", fmt.Errorf("unsupported target kind: %s", targetKind)
	}
}

// findReadyPodForWorkload finds a ready pod belonging to the workload.
// Uses label selector based on workload name (kubectl convention).
func findReadyPodForWorkload(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, kind, name string,
) (string, error) {
	// List pods and find one that belongs to this workload.
	// Pods created by workloads typically have the workload name as a prefix.
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to list pods: %w", err)
	}

	for _, pod := range pods.Items {
		if !strings.HasPrefix(pod.Name, name) {
			continue
		}
		if isPodReady(&pod) {
			return pod.Name, nil
		}
	}

	return "", fmt.Errorf("no ready pod found for %s/%s", kind, name)
}

// findReadyPodForService finds a ready pod from the service's endpoints.
func findReadyPodForService(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, serviceName string,
) (string, error) {
	endpoints, err := client.CoreV1().Endpoints(namespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get endpoints for service: %w", err)
	}

	for _, subset := range endpoints.Subsets {
		for _, addr := range subset.Addresses {
			if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" {
				// Verify the pod is ready
				pod, err := client.CoreV1().Pods(namespace).Get(ctx, addr.TargetRef.Name, metav1.GetOptions{})
				if err != nil {
					continue
				}
				if isPodReady(pod) {
					return addr.TargetRef.Name, nil
				}
			}
		}
	}

	return "", fmt.Errorf("no ready pod found for service %s", serviceName)
}

// isPodReady checks if a pod is in Running phase and has Ready condition.
func isPodReady(pod *corev1.Pod) bool {
	if pod.Status.Phase != corev1.PodRunning {
		return false
	}
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/... -run TestResolvePodForTarget -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/portforward_resolve.go backend/portforward_resolve_test.go
git commit -m "feat(portforward): add pod resolution logic for workloads and services"
```

---

## Task 4: Backend Core Port Forward Logic

**Files:**
- Create: `backend/portforward.go`
- Create: `backend/portforward_test.go`

**Step 1: Write failing test for StartPortForward**

```go
package backend

import (
	"testing"
)

func TestStartPortForward_InvalidCluster(t *testing.T) {
	app := NewApp()
	app.Ctx = nil

	_, err := app.StartPortForward("invalid-cluster", PortForwardRequest{
		Namespace:     "default",
		TargetKind:    "Pod",
		TargetName:    "my-pod",
		ContainerPort: 8080,
		LocalPort:     8080,
	})

	if err == nil {
		t.Error("expected error for invalid cluster")
	}
}

func TestListPortForwards_Empty(t *testing.T) {
	app := NewApp()

	sessions := app.ListPortForwards()
	if len(sessions) != 0 {
		t.Errorf("expected empty list, got %d sessions", len(sessions))
	}
}

func TestStopPortForward_NotFound(t *testing.T) {
	app := NewApp()

	err := app.StopPortForward("nonexistent-session")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/... -run "TestStartPortForward|TestListPortForwards|TestStopPortForward" -v`
Expected: FAIL - methods not defined

**Step 3: Write the implementation**

```go
package backend

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

// StartPortForward creates a new port forwarding session.
func (a *App) StartPortForward(clusterID string, req PortForwardRequest) (string, error) {
	deps, clusterName, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", fmt.Errorf("failed to resolve cluster: %w", err)
	}
	if deps.KubernetesClient == nil {
		return "", fmt.Errorf("kubernetes client not initialized")
	}
	if deps.RestConfig == nil {
		return "", fmt.Errorf("kubernetes rest config not initialized")
	}
	if req.Namespace == "" {
		return "", fmt.Errorf("namespace is required")
	}
	if req.TargetName == "" {
		return "", fmt.Errorf("target name is required")
	}
	if req.ContainerPort <= 0 {
		return "", fmt.Errorf("container port must be positive")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Resolve target to a pod
	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, req.Namespace, req.TargetKind, req.TargetName)
	if err != nil {
		return "", fmt.Errorf("failed to resolve pod: %w", err)
	}

	// Determine local port
	localPort := req.LocalPort
	if localPort <= 0 {
		localPort = req.ContainerPort
	}

	// Check if local port is already in use by another forward
	if a.isLocalPortInUse(localPort) {
		return "", fmt.Errorf("local port %d is already in use by another port forward", localPort)
	}

	sessionID := uuid.NewString()
	stopChan := make(chan struct{})
	sessionCtx, sessionCancel := context.WithCancel(context.Background())

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            sessionID,
			ClusterID:     clusterID,
			ClusterName:   clusterName,
			Namespace:     req.Namespace,
			PodName:       podName,
			ContainerPort: req.ContainerPort,
			LocalPort:     localPort,
			TargetKind:    req.TargetKind,
			TargetName:    req.TargetName,
			Status:        "starting",
			StartedAt:     time.Now(),
		},
		stopChan: stopChan,
		cancel:   sessionCancel,
	}

	a.portForwardSessionsMu.Lock()
	a.portForwardSessions[sessionID] = session
	a.portForwardSessionsMu.Unlock()

	// Start port forwarding in background
	go a.runPortForward(sessionCtx, session, deps)

	return sessionID, nil
}

// StopPortForward terminates a port forwarding session.
func (a *App) StopPortForward(sessionID string) error {
	a.portForwardSessionsMu.Lock()
	session, exists := a.portForwardSessions[sessionID]
	if exists {
		delete(a.portForwardSessions, sessionID)
	}
	a.portForwardSessionsMu.Unlock()

	if !exists {
		return fmt.Errorf("port forward session %q not found", sessionID)
	}

	session.close()
	a.emitPortForwardStatus(session, "stopped", "user requested stop")
	a.emitPortForwardList()
	return nil
}

// StopClusterPortForwards terminates all port forwards for a cluster.
func (a *App) StopClusterPortForwards(clusterID string) error {
	a.portForwardSessionsMu.Lock()
	var toRemove []*portForwardSessionInternal
	for id, session := range a.portForwardSessions {
		if session.ClusterID == clusterID {
			toRemove = append(toRemove, session)
			delete(a.portForwardSessions, id)
		}
	}
	a.portForwardSessionsMu.Unlock()

	for _, session := range toRemove {
		session.close()
		a.emitPortForwardStatus(session, "stopped", "cluster disconnected")
	}

	if len(toRemove) > 0 {
		a.emitPortForwardList()
	}
	return nil
}

// ListPortForwards returns all active port forwarding sessions.
func (a *App) ListPortForwards() []PortForwardSession {
	a.portForwardSessionsMu.Lock()
	defer a.portForwardSessionsMu.Unlock()

	sessions := make([]PortForwardSession, 0, len(a.portForwardSessions))
	for _, s := range a.portForwardSessions {
		sessions = append(sessions, s.PortForwardSession)
	}
	return sessions
}

// GetClusterPortForwardCount returns the number of active forwards for a cluster.
func (a *App) GetClusterPortForwardCount(clusterID string) int {
	a.portForwardSessionsMu.Lock()
	defer a.portForwardSessionsMu.Unlock()

	count := 0
	for _, s := range a.portForwardSessions {
		if s.ClusterID == clusterID {
			count++
		}
	}
	return count
}

func (a *App) runPortForward(ctx context.Context, session *portForwardSessionInternal, deps interface{ RestConfig() interface{} }) {
	// Implementation delegates to actual port forward logic
	// This will be implemented with proper deps access
	a.runPortForwardWithDeps(ctx, session)
}

func (a *App) runPortForwardWithDeps(ctx context.Context, session *portForwardSessionInternal) {
	deps, _, err := a.resolveClusterDependencies(session.ClusterID)
	if err != nil {
		a.updateSessionStatus(session, "error", fmt.Sprintf("cluster unavailable: %v", err))
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-session.stopChan:
			return
		default:
		}

		err := a.doPortForward(ctx, session, deps)
		if err == nil {
			// Clean exit
			return
		}

		// Check if we should reconnect
		if !a.shouldReconnect(session, err) {
			a.updateSessionStatus(session, "error", err.Error())
			return
		}

		// Attempt reconnection
		session.mu.Lock()
		session.reconnectAttempt++
		attempt := session.reconnectAttempt
		session.mu.Unlock()

		if attempt > portForwardMaxReconnectAttempts {
			a.updateSessionStatus(session, "error", "max reconnection attempts exceeded")
			return
		}

		a.updateSessionStatus(session, "reconnecting", fmt.Sprintf("attempt %d: %v", attempt, err))

		// Exponential backoff
		backoff := portForwardInitialBackoff * time.Duration(1<<(attempt-1))
		if backoff > portForwardMaxBackoff {
			backoff = portForwardMaxBackoff
		}

		select {
		case <-ctx.Done():
			return
		case <-session.stopChan:
			return
		case <-time.After(backoff):
		}

		// Try to find a new pod
		resolveCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		newPod, err := resolvePodForTarget(resolveCtx, deps.KubernetesClient, session.Namespace, session.TargetKind, session.TargetName)
		cancel()
		if err != nil {
			continue
		}

		session.mu.Lock()
		session.PodName = newPod
		session.mu.Unlock()
	}
}

func (a *App) doPortForward(ctx context.Context, session *portForwardSessionInternal, deps *clusterDependencies) error {
	reqURL := deps.KubernetesClient.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(session.Namespace).
		Name(session.PodName).
		SubResource("portforward").
		URL()

	transport, upgrader, err := spdy.RoundTripperFor(deps.RestConfig)
	if err != nil {
		return fmt.Errorf("failed to create round tripper: %w", err)
	}

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, http.MethodPost, reqURL)

	ports := []string{fmt.Sprintf("%d:%d", session.LocalPort, session.ContainerPort)}
	readyChan := make(chan struct{})

	pf, err := portforward.New(dialer, ports, session.stopChan, readyChan, nil, nil)
	if err != nil {
		return fmt.Errorf("failed to create port forwarder: %w", err)
	}

	errChan := make(chan error, 1)
	go func() {
		errChan <- pf.ForwardPorts()
	}()

	select {
	case <-readyChan:
		session.mu.Lock()
		session.reconnectAttempt = 0
		session.mu.Unlock()
		a.updateSessionStatus(session, "active", "")
	case err := <-errChan:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}

	// Wait for completion or error
	select {
	case err := <-errChan:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-session.stopChan:
		return nil
	}
}

func (a *App) shouldReconnect(session *portForwardSessionInternal, err error) bool {
	// Don't reconnect for direct pod forwards if pod is gone
	if session.TargetKind == "Pod" {
		return false
	}
	// Reconnect for workloads and services
	return true
}

func (a *App) updateSessionStatus(session *portForwardSessionInternal, status, reason string) {
	session.mu.Lock()
	session.Status = status
	session.StatusReason = reason
	session.mu.Unlock()

	a.emitPortForwardStatus(session, status, reason)
	a.emitPortForwardList()
}

func (a *App) isLocalPortInUse(port int) bool {
	a.portForwardSessionsMu.Lock()
	defer a.portForwardSessionsMu.Unlock()

	for _, s := range a.portForwardSessions {
		if s.LocalPort == port && s.Status != "error" && s.Status != "stopped" {
			return true
		}
	}
	return false
}

func (a *App) emitPortForwardStatus(session *portForwardSessionInternal, status, reason string) {
	a.emitEvent(portForwardStatusEventName, PortForwardStatusEvent{
		SessionID:    session.ID,
		ClusterID:    session.ClusterID,
		Status:       status,
		StatusReason: reason,
		LocalPort:    session.LocalPort,
		PodName:      session.PodName,
	})
}

func (a *App) emitPortForwardList() {
	a.emitEvent(portForwardListEventName, a.ListPortForwards())
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/... -run "TestStartPortForward|TestListPortForwards|TestStopPortForward" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/portforward.go backend/portforward_test.go
git commit -m "feat(portforward): implement core port forwarding logic with reconnection"
```

---

## Task 5: Frontend Types and Wails Bindings

**Files:**
- Regenerate: `frontend/wailsjs/go/backend/App.d.ts` (auto-generated)

**Step 1: Generate Wails bindings**

Run: `cd /Volumes/git/luxury-yacht/app && wails generate module`
Expected: Bindings regenerated with StartPortForward, StopPortForward, etc.

**Step 2: Verify bindings exist**

Run: `grep -l "StartPortForward\|StopPortForward\|ListPortForwards" frontend/wailsjs/go/backend/App.d.ts`
Expected: File contains the new methods

**Step 3: Commit**

```bash
git add frontend/wailsjs/
git commit -m "feat(portforward): regenerate Wails bindings"
```

---

## Task 6: Frontend Port Forward Modal

**Files:**
- Create: `frontend/src/modules/port-forward/PortForwardModal.tsx`
- Create: `frontend/src/modules/port-forward/PortForwardModal.css`
- Create: `frontend/src/modules/port-forward/index.ts`

**Step 1: Create the modal component**

```tsx
/**
 * frontend/src/modules/port-forward/PortForwardModal.tsx
 *
 * Modal for configuring and starting a port forward.
 */

import { useState, useCallback, useEffect } from 'react';
import { StartPortForward } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import './PortForwardModal.css';

export interface PortForwardTarget {
  kind: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName: string;
  ports: { port: number; name?: string; protocol?: string }[];
}

interface PortForwardModalProps {
  target: PortForwardTarget | null;
  onClose: () => void;
  onStarted?: (sessionId: string) => void;
}

export function PortForwardModal({ target, onClose, onStarted }: PortForwardModalProps) {
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [localPort, setLocalPort] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when target changes
  useEffect(() => {
    if (target && target.ports.length > 0) {
      const firstPort = target.ports[0].port;
      setSelectedPort(firstPort);
      setLocalPort(firstPort < 1024 ? String(firstPort + 8000) : String(firstPort));
    } else {
      setSelectedPort(null);
      setLocalPort('');
    }
    setError(null);
  }, [target]);

  const handleStart = useCallback(async () => {
    if (!target || selectedPort === null) return;

    const localPortNum = parseInt(localPort, 10);
    if (isNaN(localPortNum) || localPortNum <= 0 || localPortNum > 65535) {
      setError('Please enter a valid port number (1-65535)');
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      const sessionId = await StartPortForward(target.clusterId, {
        namespace: target.namespace,
        targetKind: target.kind,
        targetName: target.name,
        containerPort: selectedPort,
        localPort: localPortNum,
      });
      onStarted?.(sessionId);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      errorHandler.handle(err, {
        action: 'port-forward',
        kind: target.kind,
        name: target.name,
      });
    } finally {
      setIsStarting(false);
    }
  }, [target, selectedPort, localPort, onClose, onStarted]);

  if (!target) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container port-forward-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Port Forward</h2>
        </div>
        <div className="port-forward-modal-body">
          <div className="port-forward-info">
            <div className="port-forward-info-row">
              <span className="port-forward-info-label">Resource:</span>
              <span className="port-forward-info-value">
                {target.kind}/{target.name}
              </span>
            </div>
            <div className="port-forward-info-row">
              <span className="port-forward-info-label">Cluster:</span>
              <span className="port-forward-info-value">{target.clusterName}</span>
            </div>
            <div className="port-forward-info-row">
              <span className="port-forward-info-label">Namespace:</span>
              <span className="port-forward-info-value">{target.namespace}</span>
            </div>
          </div>

          {target.ports.length > 0 ? (
            <div className="port-forward-port-selection">
              <label className="port-forward-label">Container Port:</label>
              <div className="port-forward-port-options">
                {target.ports.map((p) => (
                  <label key={p.port} className="port-forward-port-option">
                    <input
                      type="radio"
                      name="containerPort"
                      value={p.port}
                      checked={selectedPort === p.port}
                      onChange={() => {
                        setSelectedPort(p.port);
                        setLocalPort(p.port < 1024 ? String(p.port + 8000) : String(p.port));
                      }}
                      disabled={isStarting}
                    />
                    <span>
                      {p.port}
                      {p.name && ` (${p.name})`}
                      {p.protocol && p.protocol !== 'TCP' && ` [${p.protocol}]`}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="port-forward-port-selection">
              <label className="port-forward-label" htmlFor="containerPortInput">
                Container Port:
              </label>
              <input
                id="containerPortInput"
                type="number"
                min={1}
                max={65535}
                value={selectedPort ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setSelectedPort(isNaN(val) ? null : val);
                }}
                className="port-forward-input"
                disabled={isStarting}
              />
            </div>
          )}

          <div className="port-forward-local-port">
            <label className="port-forward-label" htmlFor="localPortInput">
              Local Port:
            </label>
            <input
              id="localPortInput"
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              className="port-forward-input"
              disabled={isStarting}
            />
            <span className="port-forward-hint">
              Traffic to localhost:{localPort || '?'} will be forwarded to the container
            </span>
          </div>
        </div>

        {error && <div className="port-forward-modal-error">{error}</div>}

        <div className="port-forward-modal-footer">
          <button className="button cancel" onClick={onClose} disabled={isStarting}>
            Cancel
          </button>
          <button
            className="button primary"
            onClick={handleStart}
            disabled={isStarting || selectedPort === null}
          >
            {isStarting ? 'Starting...' : 'Start Forward'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Create the CSS file**

```css
/**
 * frontend/src/modules/port-forward/PortForwardModal.css
 */

.port-forward-modal {
  width: 400px;
  max-width: 90vw;
}

.port-forward-modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.port-forward-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--background-secondary);
  border-radius: 4px;
}

.port-forward-info-row {
  display: flex;
  gap: 8px;
}

.port-forward-info-label {
  color: var(--text-secondary);
  min-width: 80px;
}

.port-forward-info-value {
  color: var(--text-primary);
  font-weight: 500;
}

.port-forward-port-selection {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.port-forward-label {
  font-weight: 500;
  color: var(--text-primary);
}

.port-forward-port-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.port-forward-port-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.port-forward-port-option input[type='radio'] {
  margin: 0;
}

.port-forward-local-port {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.port-forward-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--background-primary);
  color: var(--text-primary);
  font-size: 14px;
  width: 120px;
}

.port-forward-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.port-forward-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.port-forward-modal-error {
  padding: 8px 16px;
  color: var(--danger-color);
  font-size: 13px;
}

.port-forward-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}
```

**Step 3: Create the index file**

```ts
/**
 * frontend/src/modules/port-forward/index.ts
 */

export { PortForwardModal } from './PortForwardModal';
export type { PortForwardTarget } from './PortForwardModal';
```

**Step 4: Run type check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm run typecheck`
Expected: No type errors

**Step 5: Commit**

```bash
git add frontend/src/modules/port-forward/
git commit -m "feat(portforward): add port forward modal component"
```

---

## Task 7: Frontend Port Forwards Panel

**Files:**
- Create: `frontend/src/modules/port-forward/PortForwardsPanel.tsx`
- Create: `frontend/src/modules/port-forward/PortForwardsPanel.css`
- Modify: `frontend/src/modules/port-forward/index.ts`

**Step 1: Create the panel component**

```tsx
/**
 * frontend/src/modules/port-forward/PortForwardsPanel.tsx
 *
 * Dockable panel for managing active port forwards.
 */

import { useState, useEffect, useCallback } from 'react';
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime';
import { ListPortForwards, StopPortForward } from '@wailsjs/go/backend/App';
import { DockablePanel, useDockablePanelState } from '@/components/dockable';
import { errorHandler } from '@utils/errorHandler';
import './PortForwardsPanel.css';

interface PortForwardSession {
  id: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  containerPort: number;
  localPort: number;
  targetKind: string;
  targetName: string;
  status: string;
  statusReason?: string;
  startedAt: string;
}

export function usePortForwardsPanel() {
  const panelState = useDockablePanelState('port-forwards');
  return panelState;
}

export function PortForwardsPanel() {
  const panelState = usePortForwardsPanel();
  const [sessions, setSessions] = useState<PortForwardSession[]>([]);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

  // Load initial state
  useEffect(() => {
    ListPortForwards()
      .then(setSessions)
      .catch((err) => console.error('Failed to load port forwards:', err));
  }, []);

  // Subscribe to events
  useEffect(() => {
    const handleList = (list: PortForwardSession[]) => {
      setSessions(list);
    };

    const handleStatus = (event: {
      sessionId: string;
      status: string;
      statusReason?: string;
      localPort?: number;
      podName?: string;
    }) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === event.sessionId
            ? {
                ...s,
                status: event.status,
                statusReason: event.statusReason || '',
                localPort: event.localPort ?? s.localPort,
                podName: event.podName ?? s.podName,
              }
            : s
        )
      );
    };

    EventsOn('portforward:list', handleList);
    EventsOn('portforward:status', handleStatus);

    return () => {
      EventsOff('portforward:list');
      EventsOff('portforward:status');
    };
  }, []);

  const handleStop = useCallback(async (sessionId: string) => {
    setStoppingIds((prev) => new Set(prev).add(sessionId));
    try {
      await StopPortForward(sessionId);
    } catch (err) {
      errorHandler.handle(err, { action: 'stop-port-forward' });
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, []);

  const handleRemove = useCallback((sessionId: string) => {
    // For errored sessions, just remove from local state
    // Backend will have already cleaned up
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="pf-status-icon pf-status-active">●</span>;
      case 'starting':
      case 'reconnecting':
        return <span className="pf-status-icon pf-status-reconnecting">↻</span>;
      case 'error':
      case 'stopped':
        return <span className="pf-status-icon pf-status-error">✕</span>;
      default:
        return <span className="pf-status-icon">○</span>;
    }
  };

  // Auto-open panel when first forward starts
  useEffect(() => {
    if (sessions.length > 0 && !panelState.isOpen) {
      panelState.setOpen(true);
    }
  }, [sessions.length, panelState]);

  return (
    <DockablePanel
      panelId="port-forwards"
      title="Port Forwards"
      defaultPosition="right"
      minWidth={300}
      minHeight={200}
    >
      <div className="port-forwards-panel">
        {sessions.length === 0 ? (
          <div className="pf-empty">No active port forwards</div>
        ) : (
          <div className="pf-list">
            {sessions.map((session) => (
              <div key={session.id} className={`pf-session pf-session--${session.status}`}>
                <div className="pf-session-header">
                  {getStatusIcon(session.status)}
                  <span className="pf-session-target">
                    {session.targetName}:{session.containerPort}
                  </span>
                  <span className="pf-session-arrow">→</span>
                  <span className="pf-session-local">localhost:{session.localPort}</span>
                  {session.status === 'active' || session.status === 'reconnecting' ? (
                    <button
                      className="pf-session-action"
                      onClick={() => handleStop(session.id)}
                      disabled={stoppingIds.has(session.id)}
                      title="Stop port forward"
                    >
                      {stoppingIds.has(session.id) ? '...' : 'Stop'}
                    </button>
                  ) : (
                    <button
                      className="pf-session-action"
                      onClick={() => handleRemove(session.id)}
                      title="Remove from list"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="pf-session-details">
                  <span className="pf-session-cluster">{session.clusterName}</span>
                  <span className="pf-session-namespace">/ {session.namespace}</span>
                </div>
                {session.statusReason && (
                  <div className="pf-session-reason">{session.statusReason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DockablePanel>
  );
}
```

**Step 2: Create the CSS file**

```css
/**
 * frontend/src/modules/port-forward/PortForwardsPanel.css
 */

.port-forwards-panel {
  height: 100%;
  overflow-y: auto;
  padding: 8px;
}

.pf-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}

.pf-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pf-session {
  padding: 10px 12px;
  background: var(--background-secondary);
  border-radius: 4px;
  border-left: 3px solid var(--border-color);
}

.pf-session--active {
  border-left-color: var(--success-color);
}

.pf-session--reconnecting,
.pf-session--starting {
  border-left-color: var(--warning-color);
}

.pf-session--error,
.pf-session--stopped {
  border-left-color: var(--danger-color);
  opacity: 0.8;
}

.pf-session-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.pf-status-icon {
  font-size: 12px;
}

.pf-status-active {
  color: var(--success-color);
}

.pf-status-reconnecting {
  color: var(--warning-color);
  animation: spin 1s linear infinite;
}

.pf-status-error {
  color: var(--danger-color);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.pf-session-target {
  font-weight: 500;
  color: var(--text-primary);
}

.pf-session-arrow {
  color: var(--text-secondary);
}

.pf-session-local {
  font-family: var(--font-mono);
  color: var(--accent-color);
}

.pf-session-action {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
}

.pf-session-action:hover:not(:disabled) {
  background: var(--background-hover);
  color: var(--text-primary);
}

.pf-session-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pf-session-details {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.pf-session-cluster {
  color: var(--text-secondary);
}

.pf-session-namespace {
  color: var(--text-tertiary);
}

.pf-session-reason {
  margin-top: 4px;
  font-size: 11px;
  color: var(--warning-color);
}

.pf-session--error .pf-session-reason {
  color: var(--danger-color);
}
```

**Step 3: Update index.ts**

```ts
/**
 * frontend/src/modules/port-forward/index.ts
 */

export { PortForwardModal } from './PortForwardModal';
export type { PortForwardTarget } from './PortForwardModal';
export { PortForwardsPanel, usePortForwardsPanel } from './PortForwardsPanel';
```

**Step 4: Run type check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm run typecheck`
Expected: No type errors

**Step 5: Commit**

```bash
git add frontend/src/modules/port-forward/
git commit -m "feat(portforward): add port forwards management panel"
```

---

## Task 8: Context Menu Integration

**Files:**
- Modify: `frontend/src/modules/namespace/components/NsViewWorkloads.tsx`

**Step 1: Add port forward imports and state**

At the top with other imports, add:

```tsx
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
```

Inside the `WorkloadsViewGrid` component, add state for the modal:

```tsx
const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);
```

**Step 2: Add port forward context menu item**

In the `getContextMenuItems` callback, after the "Open" item and before the CronJob-specific actions, add:

```tsx
// Port forward for pods and workloads
const portForwardableKinds = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet'];
if (portForwardableKinds.includes(normalizedKind)) {
  items.push({
    label: 'Port Forward...',
    icon: '⇄',
    onClick: () => {
      // For now, we'll need to fetch ports from the pod spec
      // This will be populated when the modal opens
      setPortForwardTarget({
        kind: row.kind,
        name: row.name,
        namespace: row.namespace,
        clusterId: row.clusterId ?? '',
        clusterName: row.clusterName ?? '',
        ports: [], // Will be populated by modal or backend
      });
    },
  });
}
```

**Step 3: Add the modal to the JSX**

At the end of the component's return statement, before the closing `</>`, add:

```tsx
<PortForwardModal
  target={portForwardTarget}
  onClose={() => setPortForwardTarget(null)}
/>
```

**Step 4: Run type check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm run typecheck`
Expected: No type errors

**Step 5: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add frontend/src/modules/namespace/components/NsViewWorkloads.tsx
git commit -m "feat(portforward): add port forward context menu item to workloads"
```

---

## Task 9: Fetch Container Ports for Modal

**Files:**
- Create: `backend/portforward_ports.go`
- Modify: `frontend/src/modules/port-forward/PortForwardModal.tsx`

**Step 1: Add backend method to get container ports**

```go
package backend

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ContainerPortInfo describes a port exposed by a container.
type ContainerPortInfo struct {
	Port     int    `json:"port"`
	Name     string `json:"name,omitempty"`
	Protocol string `json:"protocol,omitempty"`
}

// GetTargetPorts returns the container ports for a given target resource.
func (a *App) GetTargetPorts(clusterID, namespace, targetKind, targetName string) ([]ContainerPortInfo, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve cluster: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get the pod for this target
	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, namespace, targetKind, targetName)
	if err != nil {
		return nil, err
	}

	pod, err := deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	var ports []ContainerPortInfo
	seen := make(map[int]bool)

	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if seen[int(port.ContainerPort)] {
				continue
			}
			seen[int(port.ContainerPort)] = true
			ports = append(ports, ContainerPortInfo{
				Port:     int(port.ContainerPort),
				Name:     port.Name,
				Protocol: string(port.Protocol),
			})
		}
	}

	return ports, nil
}
```

**Step 2: Update modal to fetch ports**

In `PortForwardModal.tsx`, update the useEffect that handles target changes:

```tsx
// Fetch ports when target changes
useEffect(() => {
  if (!target) {
    setSelectedPort(null);
    setLocalPort('');
    setError(null);
    return;
  }

  // If ports provided, use them
  if (target.ports.length > 0) {
    const firstPort = target.ports[0].port;
    setSelectedPort(firstPort);
    setLocalPort(firstPort < 1024 ? String(firstPort + 8000) : String(firstPort));
    return;
  }

  // Otherwise fetch from backend
  import('@wailsjs/go/backend/App').then(({ GetTargetPorts }) => {
    GetTargetPorts(target.clusterId, target.namespace, target.kind, target.name)
      .then((ports) => {
        if (ports && ports.length > 0) {
          // Update target with fetched ports
          target.ports = ports;
          const firstPort = ports[0].port;
          setSelectedPort(firstPort);
          setLocalPort(firstPort < 1024 ? String(firstPort + 8000) : String(firstPort));
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch target ports:', err);
        // Allow manual entry if fetch fails
      });
  });
}, [target]);
```

**Step 3: Regenerate bindings**

Run: `cd /Volumes/git/luxury-yacht/app && wails generate module`

**Step 4: Run type check and tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm run typecheck && npm test -- --run`
Expected: All pass

**Step 5: Commit**

```bash
git add backend/portforward_ports.go frontend/src/modules/port-forward/PortForwardModal.tsx frontend/wailsjs/
git commit -m "feat(portforward): fetch container ports dynamically in modal"
```

---

## Task 10: Add Panel to App Layout

**Files:**
- Modify: `frontend/src/App.tsx` or `frontend/src/ui/layout/AppLayout.tsx`

**Step 1: Import and add the panel**

Find where other panels are rendered (likely near AppLogsPanel) and add:

```tsx
import { PortForwardsPanel } from '@modules/port-forward';
```

And in the JSX:

```tsx
<PortForwardsPanel />
```

**Step 2: Add View menu item**

Find the View menu definition and add an item for Port Forwards panel toggle.

**Step 3: Run the app**

Run: `cd /Volumes/git/luxury-yacht/app && wails dev`
Expected: App runs, panel can be opened from View menu

**Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat(portforward): integrate panel into app layout"
```

---

## Task 11: Cluster Close Confirmation

**Files:**
- Modify cluster tab close handler (location TBD based on codebase exploration)

**Step 1: Find cluster close handler**

Search for where cluster tabs are closed and add confirmation logic.

**Step 2: Add confirmation when forwards exist**

```tsx
const handleCloseCluster = async (clusterId: string) => {
  const count = await GetClusterPortForwardCount(clusterId);
  if (count > 0) {
    const confirmed = await showConfirmation({
      title: 'Active Port Forwards',
      message: `This cluster has ${count} active port forward${count > 1 ? 's' : ''}. Stop them and close?`,
      confirmLabel: 'Stop & Close',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    await StopClusterPortForwards(clusterId);
  }
  // Proceed with close
  closeCluster(clusterId);
};
```

**Step 3: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run`
Expected: All pass

**Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat(portforward): add confirmation when closing cluster with active forwards"
```

---

## Task 12: Add Tests

**Files:**
- Create: `frontend/src/modules/port-forward/PortForwardModal.test.tsx`
- Create: `frontend/src/modules/port-forward/PortForwardsPanel.test.tsx`

**Step 1: Write modal tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PortForwardModal } from './PortForwardModal';

vi.mock('@wailsjs/go/backend/App', () => ({
  StartPortForward: vi.fn().mockResolvedValue('session-123'),
}));

describe('PortForwardModal', () => {
  const mockTarget = {
    kind: 'Deployment',
    name: 'nginx',
    namespace: 'default',
    clusterId: 'cluster-1',
    clusterName: 'production',
    ports: [
      { port: 80, name: 'http' },
      { port: 443, name: 'https' },
    ],
  };

  it('renders nothing when target is null', () => {
    const { container } = render(
      <PortForwardModal target={null} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with target info', () => {
    render(<PortForwardModal target={mockTarget} onClose={() => {}} />);

    expect(screen.getByText('Port Forward')).toBeInTheDocument();
    expect(screen.getByText('Deployment/nginx')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });

  it('selects first port by default', () => {
    render(<PortForwardModal target={mockTarget} onClose={() => {}} />);

    const radio = screen.getByRole('radio', { name: /80/ });
    expect(radio).toBeChecked();
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    render(<PortForwardModal target={mockTarget} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Write panel tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortForwardsPanel } from './PortForwardsPanel';

vi.mock('@wailsjs/go/backend/App', () => ({
  ListPortForwards: vi.fn().mockResolvedValue([]),
  StopPortForward: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}));

vi.mock('@/components/dockable', () => ({
  DockablePanel: ({ children, title }: any) => (
    <div data-testid="dockable-panel" data-title={title}>{children}</div>
  ),
  useDockablePanelState: () => ({
    isOpen: true,
    setOpen: vi.fn(),
  }),
}));

describe('PortForwardsPanel', () => {
  it('renders empty state when no forwards', async () => {
    render(<PortForwardsPanel />);

    expect(await screen.findByText('No active port forwards')).toBeInTheDocument();
  });
});
```

**Step 3: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run src/modules/port-forward`
Expected: All tests pass

**Step 4: Commit**

```bash
git add frontend/src/modules/port-forward/*.test.tsx
git commit -m "test(portforward): add unit tests for modal and panel"
```

---

## Summary

This plan implements port forwarding in 12 tasks:

1. Backend types and session structure
2. Add session map to App
3. Pod resolution logic
4. Core port forward logic with reconnection
5. Wails bindings regeneration
6. Port forward modal component
7. Port forwards panel component
8. Context menu integration
9. Dynamic port fetching
10. App layout integration
11. Cluster close confirmation
12. Unit tests

Each task is self-contained with clear files, code, and verification steps.
