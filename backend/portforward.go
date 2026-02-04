/*
 * backend/portforward.go
 *
 * Core port forwarding functionality.
 * - Starts and manages port forwarding sessions to Kubernetes pods.
 * - Supports auto-reconnect for workloads/services (not direct pod forwards).
 * - Emits status events to the frontend for UI updates.
 */

package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

// StartPortForward initiates a new port forwarding session to a Kubernetes pod.
// For workloads (Deployment, StatefulSet, DaemonSet) and Services, the session
// will automatically reconnect if the underlying pod is replaced.
func (a *App) StartPortForward(clusterID string, req PortForwardRequest) (string, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	if deps.KubernetesClient == nil {
		return "", fmt.Errorf("kubernetes client not initialized")
	}
	if deps.RestConfig == nil {
		return "", fmt.Errorf("kubernetes rest config not initialized")
	}

	// Validate request.
	if req.Namespace == "" {
		return "", fmt.Errorf("namespace is required")
	}
	if req.TargetName == "" {
		return "", fmt.Errorf("target name is required")
	}
	if req.ContainerPort <= 0 {
		return "", fmt.Errorf("container port must be positive")
	}

	// Resolve the target to a pod.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, req.Namespace, req.TargetKind, req.TargetName)
	if err != nil {
		return "", fmt.Errorf("failed to resolve pod: %w", err)
	}

	// Create session.
	sessionID := uuid.NewString()
	sessionCtx, sessionCancel := context.WithCancel(context.Background())

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            sessionID,
			ClusterID:     clusterID,
			ClusterName:   deps.ClusterName,
			Namespace:     req.Namespace,
			PodName:       podName,
			ContainerPort: req.ContainerPort,
			LocalPort:     req.LocalPort,
			TargetKind:    req.TargetKind,
			TargetName:    req.TargetName,
			Status:        "connecting",
			StartedAt:     time.Now(),
		},
		stopChan:  make(chan struct{}),
		readyChan: make(chan error, 1),
		cancel:    sessionCancel,
	}

	// Register session before starting.
	a.portForwardSessionsMu.Lock()
	a.portForwardSessions[sessionID] = session
	a.portForwardSessionsMu.Unlock()

	// Emit initial status.
	a.emitPortForwardStatus(session)

	// Start the forwarder in a goroutine.
	go a.runPortForwarder(sessionCtx, session, deps)

	// Wait for initial connection to succeed or fail.
	select {
	case err := <-session.readyChan:
		if err != nil {
			// Initial connection failed - remove session and return error.
			a.removePortForwardSession(sessionID)
			a.emitPortForwardList()
			return "", fmt.Errorf("failed to start port forward: %w", err)
		}
	case <-time.After(30 * time.Second):
		// Timeout waiting for connection.
		a.removePortForwardSession(sessionID)
		session.close()
		a.emitPortForwardList()
		return "", fmt.Errorf("timeout waiting for port forward to connect")
	}

	return sessionID, nil
}

// StopPortForward terminates a specific port forwarding session.
func (a *App) StopPortForward(sessionID string) error {
	session := a.removePortForwardSession(sessionID)
	if session == nil {
		return fmt.Errorf("port forward session %q not found", sessionID)
	}
	session.close()

	session.mu.Lock()
	session.Status = "stopped"
	session.StatusReason = "user stopped"
	session.mu.Unlock()

	a.emitPortForwardStatus(session)
	a.emitPortForwardList()
	return nil
}

// StopClusterPortForwards terminates all port forwards for a specific cluster.
// Called when a cluster is disconnected to clean up resources.
func (a *App) StopClusterPortForwards(clusterID string) error {
	a.portForwardSessionsMu.Lock()
	var toRemove []*portForwardSessionInternal
	for _, session := range a.portForwardSessions {
		if session.ClusterID == clusterID {
			toRemove = append(toRemove, session)
		}
	}
	for _, session := range toRemove {
		delete(a.portForwardSessions, session.ID)
	}
	a.portForwardSessionsMu.Unlock()

	// Close all sessions outside the lock.
	for _, session := range toRemove {
		session.close()
		session.mu.Lock()
		session.Status = "stopped"
		session.StatusReason = "cluster disconnected"
		session.mu.Unlock()
		a.emitPortForwardStatus(session)
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
	for _, session := range a.portForwardSessions {
		session.mu.Lock()
		sessions = append(sessions, session.PortForwardSession)
		session.mu.Unlock()
	}

	// Sort by start time for consistent ordering.
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.Before(sessions[j].StartedAt)
	})

	return sessions
}

// GetClusterPortForwardCount returns the number of active port forwards for a cluster.
func (a *App) GetClusterPortForwardCount(clusterID string) int {
	a.portForwardSessionsMu.Lock()
	defer a.portForwardSessionsMu.Unlock()

	count := 0
	for _, session := range a.portForwardSessions {
		if session.ClusterID == clusterID {
			count++
		}
	}
	return count
}

// runPortForwarder manages the port forwarding connection and handles reconnection.
func (a *App) runPortForwarder(ctx context.Context, session *portForwardSessionInternal, deps interface{}) {
	defer func() {
		a.removePortForwardSession(session.ID)
		a.emitPortForwardList()
	}()

	isFirstAttempt := true

	for {
		select {
		case <-ctx.Done():
			return
		case <-session.stopChan:
			return
		default:
		}

		err := a.executePortForward(ctx, session)

		// Signal readyChan on first attempt (success or failure).
		if isFirstAttempt {
			isFirstAttempt = false
			if err != nil {
				// First attempt failed - signal the error.
				select {
				case session.readyChan <- err:
				default:
				}
			}
			// Success is signaled inside executePortForward after "active" status.
		}

		if err == nil {
			// Clean exit (stop channel closed).
			return
		}

		// Check if we should reconnect.
		if !a.shouldReconnect(session) {
			session.mu.Lock()
			session.Status = "error"
			session.StatusReason = err.Error()
			session.mu.Unlock()
			a.emitPortForwardStatus(session)
			return
		}

		// Attempt reconnection with exponential backoff.
		session.mu.Lock()
		session.reconnectAttempt++
		attempt := session.reconnectAttempt
		session.Status = "reconnecting"
		session.StatusReason = fmt.Sprintf("attempt %d/%d: %s", attempt, portForwardMaxReconnectAttempts, err.Error())
		session.mu.Unlock()
		a.emitPortForwardStatus(session)

		if attempt > portForwardMaxReconnectAttempts {
			session.mu.Lock()
			session.Status = "error"
			session.StatusReason = "max reconnect attempts exceeded"
			session.mu.Unlock()
			a.emitPortForwardStatus(session)
			return
		}

		// Calculate backoff duration.
		backoff := a.calculateBackoff(attempt)

		select {
		case <-ctx.Done():
			return
		case <-session.stopChan:
			return
		case <-time.After(backoff):
		}

		// Re-resolve the pod (it may have changed for workloads/services).
		if err := a.reresolvePod(ctx, session); err != nil {
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Failed to re-resolve pod for %s: %v", session.ID, err), "PortForward")
			}
			continue
		}
	}
}

// executePortForward runs the actual port forward connection.
func (a *App) executePortForward(ctx context.Context, session *portForwardSessionInternal) error {
	deps, _, err := a.resolveClusterDependencies(session.ClusterID)
	if err != nil {
		return fmt.Errorf("failed to resolve cluster: %w", err)
	}

	session.mu.Lock()
	podName := session.PodName
	namespace := session.Namespace
	containerPort := session.ContainerPort
	localPort := session.LocalPort
	session.mu.Unlock()

	// Build the pod port-forward URL.
	podURL := deps.KubernetesClient.CoreV1().
		RESTClient().
		Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("portforward").
		URL()

	// Create SPDY transport.
	transport, upgrader, err := spdy.RoundTripperFor(deps.RestConfig)
	if err != nil {
		return fmt.Errorf("failed to create SPDY transport: %w", err)
	}

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, http.MethodPost, podURL)

	// Build port mapping string.
	ports := []string{fmt.Sprintf("%d:%d", localPort, containerPort)}

	// Create channels for port forwarder.
	readyChan := make(chan struct{})
	errChan := make(chan error, 1)

	// Create the port forwarder.
	pf, err := portforward.New(dialer, ports, session.stopChan, readyChan, nil, nil)
	if err != nil {
		return fmt.Errorf("failed to create port forwarder: %w", err)
	}

	// Run the port forwarder in a goroutine.
	go func() {
		errChan <- pf.ForwardPorts()
	}()

	// Wait for ready or error.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-session.stopChan:
		return nil
	case err := <-errChan:
		return err
	case <-readyChan:
	}

	// Get the actual local ports (may differ if 0 was specified).
	forwardedPorts, err := pf.GetPorts()
	if err != nil {
		return fmt.Errorf("failed to get forwarded ports: %w", err)
	}

	// Update session with actual local port.
	if len(forwardedPorts) > 0 {
		session.mu.Lock()
		session.LocalPort = int(forwardedPorts[0].Local)
		session.Status = "active"
		session.StatusReason = ""
		session.reconnectAttempt = 0
		session.mu.Unlock()
		a.emitPortForwardStatus(session)
		a.emitPortForwardList()

		// Signal success on readyChan (non-blocking).
		select {
		case session.readyChan <- nil:
		default:
		}
	}

	// Wait for completion.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-session.stopChan:
		return nil
	case err := <-errChan:
		return err
	}
}

// shouldReconnect determines if the session should attempt auto-reconnection.
// Only workloads and services support reconnection since the underlying pod may change.
// Direct pod forwards do not reconnect because the specific pod is gone.
func (a *App) shouldReconnect(session *portForwardSessionInternal) bool {
	session.mu.Lock()
	defer session.mu.Unlock()

	switch session.TargetKind {
	case "Deployment", "StatefulSet", "DaemonSet", "Service":
		return true
	default:
		return false
	}
}

// calculateBackoff returns the backoff duration for a reconnect attempt.
// Uses exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
func (a *App) calculateBackoff(attempt int) time.Duration {
	backoff := portForwardInitialBackoff
	for i := 1; i < attempt; i++ {
		backoff *= 2
		if backoff > portForwardMaxBackoff {
			backoff = portForwardMaxBackoff
			break
		}
	}
	return backoff
}

// reresolvePod attempts to find a new pod for the session's target.
func (a *App) reresolvePod(ctx context.Context, session *portForwardSessionInternal) error {
	deps, _, err := a.resolveClusterDependencies(session.ClusterID)
	if err != nil {
		return err
	}

	session.mu.Lock()
	namespace := session.Namespace
	targetKind := session.TargetKind
	targetName := session.TargetName
	session.mu.Unlock()

	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, namespace, targetKind, targetName)
	if err != nil {
		return err
	}

	session.mu.Lock()
	session.PodName = podName
	session.mu.Unlock()
	return nil
}

// removePortForwardSession removes and returns a session from the map.
func (a *App) removePortForwardSession(sessionID string) *portForwardSessionInternal {
	a.portForwardSessionsMu.Lock()
	defer a.portForwardSessionsMu.Unlock()

	session, ok := a.portForwardSessions[sessionID]
	if ok {
		delete(a.portForwardSessions, sessionID)
	}
	return session
}

// getPortForwardSession returns a session by ID.
func (a *App) getPortForwardSession(sessionID string) *portForwardSessionInternal {
	a.portForwardSessionsMu.Lock()
	defer a.portForwardSessionsMu.Unlock()
	return a.portForwardSessions[sessionID]
}

// emitPortForwardStatus sends a status update event for a session.
func (a *App) emitPortForwardStatus(session *portForwardSessionInternal) {
	if session == nil {
		return
	}

	session.mu.Lock()
	event := PortForwardStatusEvent{
		SessionID:    session.ID,
		ClusterID:    session.ClusterID,
		Status:       session.Status,
		StatusReason: session.StatusReason,
		LocalPort:    session.LocalPort,
		PodName:      session.PodName,
	}
	session.mu.Unlock()

	a.emitEvent(portForwardStatusEventName, event)
}

// emitPortForwardList sends the current list of port forwards.
func (a *App) emitPortForwardList() {
	sessions := a.ListPortForwards()
	a.emitEvent(portForwardListEventName, sessions)
}

// ValidatePortForwardURL checks if a URL string is valid and safe for port forwarding.
// This is a utility function for the frontend to validate URLs.
func (a *App) ValidatePortForwardURL(urlStr string) (bool, string) {
	if urlStr == "" {
		return false, "URL is required"
	}

	// Parse the URL.
	u, err := url.Parse(urlStr)
	if err != nil {
		return false, fmt.Sprintf("invalid URL: %v", err)
	}

	// Only allow http and https schemes.
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return false, "only http and https URLs are allowed"
	}

	// Must have a host.
	if u.Host == "" {
		return false, "URL must have a host"
	}

	return true, ""
}
