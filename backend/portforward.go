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
	"strings"
	"time"

	podspkg "github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

func (o *OperationsCoordinator) startPortForwardAction(targetRef ObjectActionTargetRef, options ObjectActionPortForwardOptions) (string, error) {
	operationEpoch := o.clusterOperationEpoch(targetRef.ClusterID)
	req := PortForwardRequest{
		Namespace:     targetRef.Namespace,
		TargetKind:    targetRef.Kind,
		TargetGroup:   targetRef.Group,
		TargetVersion: targetRef.Version,
		TargetName:    targetRef.Name,
		ContainerPort: options.ContainerPort,
		LocalPort:     options.LocalPort,
	}
	target, err := portForwardTargetFromRequest(req)
	if err != nil {
		return "", err
	}
	if req.ContainerPort <= 0 {
		return "", fmt.Errorf("container port must be positive")
	}

	if o == nil || o.clusterAccess == nil {
		return "", fmt.Errorf("cluster access not initialized")
	}
	deps, _, err := o.clusterAccess.ResolveClusterDependencies(targetRef.ClusterID)
	if err != nil {
		return "", err
	}
	if deps.KubernetesClient == nil {
		return "", fmt.Errorf("kubernetes client not initialized")
	}
	if deps.RestConfig == nil {
		return "", fmt.Errorf("kubernetes rest config not initialized")
	}

	// Resolve the target to a pod.
	ctx, cancel := context.WithTimeout(o.operationContext(), config.PortForwardResolveTimeout)
	defer cancel()

	resolved, err := resolvePortForwardDestination(ctx, deps.KubernetesClient, target, req.ContainerPort)
	if err != nil {
		return "", fmt.Errorf("failed to resolve pod: %w", err)
	}

	if err := o.permissions.Require(ctx, deps, OperationsPermissionCheck{
		Version:     "v1",
		Kind:        podspkg.Identity.Kind,
		Namespace:   target.Namespace,
		Name:        resolved.PodName,
		Verb:        "create",
		Subresource: "portforward",
	}); err != nil {
		return "", err
	}

	// Create session.
	sessionID := uuid.NewString()
	sessionCtx, sessionCancel := context.WithCancel(o.operationContext())

	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            sessionID,
			ClusterID:     targetRef.ClusterID,
			ClusterName:   deps.ClusterName,
			Namespace:     target.Namespace,
			PodName:       resolved.PodName,
			ContainerPort: req.ContainerPort,
			LocalPort:     req.LocalPort,
			TargetKind:    target.Kind,
			TargetGroup:   target.Group,
			TargetVersion: target.Version,
			TargetName:    target.Name,
			Status:        PortForwardStatusConnecting,
			StartedAt:     time.Now().Format(time.RFC3339),
		},
		stopChan:       make(chan struct{}),
		readyChan:      make(chan error, 1),
		cancel:         sessionCancel,
		operationEpoch: operationEpoch,
	}

	lifecycle := o.portForwardLifecycle()
	if !lifecycle.registerStarting(session) {
		session.close()
		return "", fmt.Errorf("cluster disconnected before port forward started")
	}

	// Start the forwarder in a goroutine.
	go o.runPortForwarder(sessionCtx, session)

	// Wait for initial connection to succeed or fail.
	select {
	case err := <-session.readyChan:
		if err != nil {
			lifecycle.finishStartFailure(sessionID)
			return "", fmt.Errorf("failed to start port forward: %w", err)
		}
	case <-time.After(config.PortForwardConnectTimeout):
		lifecycle.finishStartTimeout(sessionID)
		return "", fmt.Errorf("timeout waiting for port forward to connect")
	}

	return sessionID, nil
}

// StopPortForward terminates a specific port forwarding session.
func (o *OperationsCoordinator) StopPortForward(sessionID string) error {
	return o.portForwardLifecycle().stopByUser(sessionID)
}

// ListPortForwards returns all active port forwarding sessions.
func (o *OperationsCoordinator) ListPortForwards() []PortForwardSession {
	return o.portForwardLifecycle().list()
}

// GetClusterPortForwardCount returns the number of active port forwards for a cluster.
func (o *OperationsCoordinator) GetClusterPortForwardCount(clusterID string) int {
	return o.portForwardLifecycle().countCluster(clusterID)
}

// runPortForwarder manages the port forwarding connection and handles reconnection.
func (o *OperationsCoordinator) runPortForwarder(ctx context.Context, session *portForwardSessionInternal) {
	defer func() {
		o.portForwardLifecycle().finishTerminal(session.ID)
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

		err := o.executePortForward(ctx, session)

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
		if !o.shouldReconnect(session) {
			session.mu.Lock()
			session.Status = PortForwardStatusError
			session.StatusReason = err.Error()
			session.mu.Unlock()
			o.portForwardLifecycle().emitStatus(session)
			return
		}

		// Attempt reconnection with exponential backoff.
		session.mu.Lock()
		session.reconnectAttempt++
		attempt := session.reconnectAttempt
		session.Status = PortForwardStatusReconnecting
		session.StatusReason = fmt.Sprintf("attempt %d/%d: %s", attempt, config.PortForwardMaxReconnectAttempts, err.Error())
		session.mu.Unlock()
		o.portForwardLifecycle().emitStatus(session)

		if attempt > config.PortForwardMaxReconnectAttempts {
			session.mu.Lock()
			session.Status = PortForwardStatusError
			session.StatusReason = "max reconnect attempts exceeded"
			session.mu.Unlock()
			o.portForwardLifecycle().emitStatus(session)
			return
		}

		// Calculate backoff duration.
		backoff := o.calculateBackoff(attempt)

		select {
		case <-ctx.Done():
			return
		case <-session.stopChan:
			return
		case <-time.After(backoff):
		}

		// Re-resolve the pod (it may have changed for workloads/services).
		if err := o.reresolvePod(ctx, session); err != nil {
			if o.logger != nil {
				o.logger.Warn(fmt.Sprintf("Failed to re-resolve pod for %s: %v", session.ID, err), logsources.PortForward)
			}
			continue
		}
	}
}

// executePortForward runs the actual port forward connection.
func (o *OperationsCoordinator) executePortForward(ctx context.Context, session *portForwardSessionInternal) error {
	if o == nil || o.clusterAccess == nil {
		return fmt.Errorf("cluster access not initialized")
	}
	deps, _, err := o.clusterAccess.ResolveClusterDependencies(session.ClusterID)
	if err != nil {
		return fmt.Errorf("failed to resolve cluster: %w", err)
	}

	session.mu.Lock()
	namespace := session.Namespace
	localPort := session.LocalPort
	target := portForwardTargetRef{
		Namespace: namespace,
		Kind:      session.TargetKind,
		Group:     session.TargetGroup,
		Version:   session.TargetVersion,
		Name:      session.TargetName,
	}
	session.mu.Unlock()

	resolved, err := resolvePortForwardDestination(ctx, deps.KubernetesClient, target, session.ContainerPort)
	if err != nil {
		return fmt.Errorf("failed to resolve target port: %w", err)
	}
	podName := resolved.PodName
	forwardPort := resolved.ForwardPort

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
	ports := []string{fmt.Sprintf("%d:%d", localPort, forwardPort)}

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
		o.portForwardLifecycle().markActive(session, int(forwardedPorts[0].Local))

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
func (o *OperationsCoordinator) shouldReconnect(session *portForwardSessionInternal) bool {
	session.mu.Lock()
	defer session.mu.Unlock()

	capability, ok := lookupPortForwardTargetCapability(session.TargetKind)
	return ok && capability.Reconnect
}

// calculateBackoff returns the backoff duration for a reconnect attempt.
// Uses exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
func (o *OperationsCoordinator) calculateBackoff(attempt int) time.Duration {
	backoff := config.PortForwardInitialBackoff
	for i := 1; i < attempt; i++ {
		backoff *= 2
		if backoff > config.PortForwardMaxBackoff {
			backoff = config.PortForwardMaxBackoff
			break
		}
	}
	return backoff
}

// reresolvePod attempts to find a new pod for the session's target.
func (o *OperationsCoordinator) reresolvePod(ctx context.Context, session *portForwardSessionInternal) error {
	if o == nil || o.clusterAccess == nil {
		return fmt.Errorf("cluster access not initialized")
	}
	deps, _, err := o.clusterAccess.ResolveClusterDependencies(session.ClusterID)
	if err != nil {
		return err
	}

	session.mu.Lock()
	target := portForwardTargetRef{
		Namespace: session.Namespace,
		Kind:      session.TargetKind,
		Group:     session.TargetGroup,
		Version:   session.TargetVersion,
		Name:      session.TargetName,
	}
	session.mu.Unlock()

	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, target)
	if err != nil {
		return err
	}

	session.mu.Lock()
	session.PodName = podName
	session.mu.Unlock()
	return nil
}

func runtimeOperationFromPortForward(session *portForwardSessionInternal) RuntimeOperation {
	if session == nil {
		return RuntimeOperation{}
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	return RuntimeOperation{
		ID:          session.ID,
		Type:        RuntimeOperationPortForward,
		ClusterID:   session.ClusterID,
		ClusterName: session.ClusterName,
		Target: runtimeOperationTarget(
			session.ClusterID,
			session.TargetGroup,
			session.TargetVersion,
			session.TargetKind,
			session.Namespace,
			session.TargetName,
		),
		Status:       string(session.Status),
		StatusReason: session.StatusReason,
		StartedAt:    session.StartedAt,
		DisplayName:  fmt.Sprintf("Port forward %s/%s", session.Namespace, session.TargetName),
		Summary: map[string]string{
			"podName":       session.PodName,
			"containerPort": fmt.Sprintf("%d", session.ContainerPort),
			"localPort":     fmt.Sprintf("%d", session.LocalPort),
		},
	}
}

// ValidatePortForwardURL checks if a URL string is valid and safe for port forwarding.
// This is a utility function for the frontend to validate URLs.
func (o *OperationsCoordinator) ValidatePortForwardURL(urlStr string) (bool, string) {
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
