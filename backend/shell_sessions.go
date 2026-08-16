package backend

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	podspkg "github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/streaming/pkg/httpstream"
)

const (
	shellOutputEventName = "object-shell:output"
	shellStatusEventName = "object-shell:status"
	shellListEventName   = "object-shell:list"

	// shellOutputBacklogMaxBytes bounds replay memory used per shell session.
	shellOutputBacklogMaxBytes = 256 * 1024
	maxTerminalDimension       = 65535
)

type shellSession struct {
	id          string
	clusterID   string
	clusterName string
	namespace   string
	podName     string
	container   string
	command     []string
	stdin       *io.PipeWriter
	stdinR      *io.PipeReader
	sizeQueue   *terminalSizeQueue
	cancel      context.CancelFunc
	once        sync.Once

	activityMu   sync.Mutex
	lastActivity time.Time
	startedAt    time.Time

	backlogMu      sync.Mutex
	backlog        []string
	backlogBytes   int
	operationEpoch uint64
}

// touchActivity updates the last activity timestamp.
func (s *shellSession) touchActivity() {
	s.activityMu.Lock()
	s.lastActivity = time.Now()
	s.activityMu.Unlock()
}

// idleDuration returns how long the session has been idle.
func (s *shellSession) idleDuration() time.Duration {
	s.activityMu.Lock()
	defer s.activityMu.Unlock()
	return time.Since(s.lastActivity)
}

// totalDuration returns how long the session has been running.
func (s *shellSession) totalDuration() time.Duration {
	return time.Since(s.startedAt)
}

// appendBacklog stores output for replay while enforcing a bounded memory cap.
func (s *shellSession) appendBacklog(data string) {
	if data == "" {
		return
	}
	s.backlogMu.Lock()
	defer s.backlogMu.Unlock()

	s.backlog = append(s.backlog, data)
	s.backlogBytes += len(data)

	for s.backlogBytes > shellOutputBacklogMaxBytes && len(s.backlog) > 0 {
		dropped := s.backlog[0]
		s.backlog = s.backlog[1:]
		s.backlogBytes -= len(dropped)
	}
}

// snapshotBacklog returns the session's buffered output in stream order.
func (s *shellSession) snapshotBacklog() string {
	s.backlogMu.Lock()
	defer s.backlogMu.Unlock()
	if len(s.backlog) == 0 || s.backlogBytes <= 0 {
		return ""
	}
	var builder strings.Builder
	builder.Grow(s.backlogBytes)
	for _, chunk := range s.backlog {
		builder.WriteString(chunk)
	}
	return builder.String()
}

func (s *shellSession) Close() {
	s.once.Do(func() {
		if s.stdin != nil {
			_ = s.stdin.Close()
		}
		if s.stdinR != nil {
			_ = s.stdinR.Close()
		}
		if s.sizeQueue != nil {
			s.sizeQueue.Close()
		}
		if s.cancel != nil {
			s.cancel()
		}
	})
}

type terminalSizeQueue struct {
	ch   chan remotecommand.TerminalSize
	once sync.Once
}

func newTerminalSizeQueue() *terminalSizeQueue {
	return &terminalSizeQueue{
		ch: make(chan remotecommand.TerminalSize, 1),
	}
}

func (q *terminalSizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.ch
	if !ok {
		return nil
	}
	return &size
}

func (q *terminalSizeQueue) Set(width, height uint16) {
	if width == 0 || height == 0 {
		return
	}
	select {
	case q.ch <- remotecommand.TerminalSize{Width: width, Height: height}:
	default:
	}
}

func (q *terminalSizeQueue) Close() {
	q.once.Do(func() {
		close(q.ch)
	})
}

type shellEventWriter struct {
	coordinator *OperationsCoordinator
	sessionID   string
	clusterID   string
	stream      string
	session     *shellSession
}

type shellLaunch struct {
	deps      common.Dependencies
	pod       *corev1.Pod
	container string
	command   []string
	executor  remotecommand.Executor
}

func (w *shellEventWriter) Write(p []byte) (int, error) {
	if len(p) == 0 || w.coordinator == nil {
		return len(p), nil
	}
	chunk := string(p)
	if w.session != nil {
		w.session.touchActivity()
		w.session.appendBacklog(chunk)
	}
	w.coordinator.shellSessionLifecycle().emitOutput(w.sessionID, w.clusterID, w.stream, chunk)
	return len(p), nil
}

// StartShellSession launches a kubectl exec session and begins streaming data back to the frontend.
func (o *OperationsCoordinator) StartShellSession(clusterID string, req ShellSessionRequest) (*ShellSession, error) {
	operationEpoch := o.clusterOperationEpoch(clusterID)
	launch, err := o.prepareShellLaunch(clusterID, req)
	if err != nil {
		return nil, err
	}
	sess, sessionCtx := newShellSession(o.operationContext(), clusterID, req, launch, operationEpoch)
	lifecycle := o.shellSessionLifecycle()
	if !lifecycle.register(sess) {
		sess.Close()
		return nil, fmt.Errorf("cluster disconnected before shell session started")
	}
	go o.monitorShellTimeout(sessionCtx, sess)
	o.startShellSessionStream(lifecycle, sessionCtx, sess, launch.executor)
	lifecycle.emitStatus(sess.id, clusterID, "open", "")
	return shellSessionResponse(sess, launch.pod), nil
}

func (o *OperationsCoordinator) prepareShellLaunch(clusterID string, req ShellSessionRequest) (shellLaunch, error) {
	if err := requirePodObject(req.Namespace, req.PodName); err != nil {
		return shellLaunch{}, err
	}

	if o == nil || o.clusterAccess == nil {
		return shellLaunch{}, fmt.Errorf("cluster access not initialized")
	}
	deps, _, err := o.clusterAccess.ResolveClusterDependencies(clusterID)
	if err != nil {
		return shellLaunch{}, err
	}
	if err := validateShellDependencies(deps); err != nil {
		return shellLaunch{}, err
	}

	ctx, cancel := context.WithTimeout(o.operationContext(), config.ShellSessionShutdownTimeout)
	defer cancel()

	podIdentifier := fmt.Sprintf("%s/%s", req.Namespace, req.PodName)
	pod, err := o.clusterAccess.FetchPodWithRetry(ctx, clusterID, podIdentifier, func(fetchCtx context.Context) (*corev1.Pod, error) {
		return deps.KubernetesClient.CoreV1().Pods(req.Namespace).Get(fetchCtx, req.PodName, metav1.GetOptions{})
	})
	if err != nil {
		return shellLaunch{}, fmt.Errorf("failed to load pod: %w", err)
	}
	container, err := shellContainerForPod(pod, req.Container)
	if err != nil {
		return shellLaunch{}, err
	}
	if err := o.requireShellExecPermission(ctx, deps, req); err != nil {
		return shellLaunch{}, err
	}
	command := shellCommand(req.Command)
	executor, err := o.buildShellExecutor(deps, req, container, command)
	if err != nil {
		return shellLaunch{}, err
	}
	return shellLaunch{deps: deps, pod: pod, container: container, command: command, executor: executor}, nil
}

func validateShellDependencies(deps common.Dependencies) error {
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}
	if deps.RestConfig == nil {
		return fmt.Errorf("kubernetes rest config not initialized")
	}
	return nil
}

func shellContainerForPod(pod *corev1.Pod, requested string) (string, error) {
	if len(pod.Spec.Containers) == 0 && len(pod.Spec.EphemeralContainers) == 0 {
		return "", fmt.Errorf("pod has no containers available for exec")
	}
	container := requested
	if container == "" && len(pod.Spec.Containers) > 0 {
		container = pod.Spec.Containers[0].Name
	}
	if container == "" {
		container = pod.Spec.EphemeralContainers[0].Name
	}
	if !hasContainer(pod.Spec.Containers, container) && !hasEphemeralContainer(pod.Spec.EphemeralContainers, container) {
		return "", fmt.Errorf("container %q not found in pod %s", container, pod.Name)
	}
	return container, nil
}

func (o *OperationsCoordinator) requireShellExecPermission(ctx context.Context, deps common.Dependencies, req ShellSessionRequest) error {
	return o.permissions.RequireAny(ctx, deps,
		OperationsPermissionCheck{
			Version:     "v1",
			Kind:        podspkg.Identity.Kind,
			Namespace:   req.Namespace,
			Name:        req.PodName,
			Verb:        "get",
			Subresource: "exec",
		},
		OperationsPermissionCheck{
			Version:     "v1",
			Kind:        podspkg.Identity.Kind,
			Namespace:   req.Namespace,
			Name:        req.PodName,
			Verb:        "create",
			Subresource: "exec",
		},
	)
}

func shellCommand(requested []string) []string {
	command := requested
	if len(command) == 0 {
		command = []string{"/bin/sh"}
	}
	return command
}

func (o *OperationsCoordinator) buildShellExecutor(
	deps common.Dependencies,
	req ShellSessionRequest,
	container string,
	command []string,
) (remotecommand.Executor, error) {
	execReq := deps.KubernetesClient.CoreV1().
		RESTClient().
		Post().
		Resource("pods").
		Namespace(req.Namespace).
		Name(req.PodName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   command,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	websocketExec, err := o.websocketExec(deps.RestConfig, http.MethodGet, execReq.URL().String())
	if err != nil {
		return nil, fmt.Errorf("failed to create websocket executor: %w", err)
	}
	spdyExecutor, err := o.spdyExecutor(deps.RestConfig, http.MethodPost, execReq.URL())
	if err != nil {
		return nil, fmt.Errorf("failed to create SPDY executor: %w", err)
	}

	// Use websocket exec when possible, but fall back to SPDY on upgrade or proxy errors.
	executor, err := remotecommand.NewFallbackExecutor(websocketExec, spdyExecutor, func(err error) bool {
		return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create fallback executor: %w", err)
	}
	return executor, nil
}

func newShellSession(parent context.Context, clusterID string, req ShellSessionRequest, launch shellLaunch, operationEpoch uint64) (*shellSession, context.Context) {
	sessionID := uuid.NewString()
	stdinReader, stdinWriter := io.Pipe()
	sizeQueue := newTerminalSizeQueue()
	sizeQueue.Set(120, 40)
	if parent == nil {
		parent = context.Background()
	}
	sessionCtx, sessionCancel := context.WithCancel(parent)
	now := time.Now()
	sess := &shellSession{
		id:             sessionID,
		clusterID:      clusterID,
		clusterName:    launch.deps.ClusterName,
		namespace:      req.Namespace,
		podName:        req.PodName,
		container:      launch.container,
		command:        append([]string(nil), launch.command...),
		stdin:          stdinWriter,
		stdinR:         stdinReader,
		sizeQueue:      sizeQueue,
		cancel:         sessionCancel,
		startedAt:      now,
		lastActivity:   now,
		operationEpoch: operationEpoch,
	}
	if sess.clusterName == "" {
		sess.clusterName = clusterID
	}
	return sess, sessionCtx
}

func (o *OperationsCoordinator) startShellSessionStream(
	lifecycle shellSessionLifecycle,
	sessionCtx context.Context,
	sess *shellSession,
	executor remotecommand.Executor,
) {
	go func() {
		streamErr := executor.StreamWithContext(sessionCtx, remotecommand.StreamOptions{
			Stdin:             sess.stdinR,
			Stdout:            &shellEventWriter{coordinator: o, sessionID: sess.id, clusterID: sess.clusterID, stream: "stdout", session: sess},
			Stderr:            &shellEventWriter{coordinator: o, sessionID: sess.id, clusterID: sess.clusterID, stream: "stderr", session: sess},
			Tty:               true,
			TerminalSizeQueue: sess.sizeQueue,
		})

		if streamErr != nil {
			lifecycle.finishStream(sess.id, "error", streamErr.Error())
		} else {
			lifecycle.finishStream(sess.id, "closed", "")
		}
	}()
}

func shellSessionResponse(sess *shellSession, pod *corev1.Pod) *ShellSession {
	containers := make([]string, 0, len(pod.Spec.Containers)+len(pod.Spec.EphemeralContainers))
	for _, c := range pod.Spec.Containers {
		containers = append(containers, c.Name)
	}
	for _, c := range pod.Spec.EphemeralContainers {
		containers = append(containers, c.Name)
	}

	return &ShellSession{
		SessionID:  sess.id,
		Namespace:  sess.namespace,
		PodName:    sess.podName,
		Container:  sess.container,
		Command:    append([]string(nil), sess.command...),
		Containers: containers,
	}
}

// SendShellInput writes stdin data to an active exec session.
func (o *OperationsCoordinator) SendShellInput(sessionID, data string) error {
	if data == "" {
		return nil
	}
	sess := o.shellSessionLifecycle().get(sessionID)
	if sess == nil {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	sess.touchActivity()
	if _, err := sess.stdin.Write([]byte(data)); err != nil {
		return fmt.Errorf("failed to send input: %w", err)
	}
	return nil
}

// ResizeShellSession notifies Kubernetes about the new TTY size.
func (o *OperationsCoordinator) ResizeShellSession(sessionID string, columns, rows int) error {
	if columns <= 0 || rows <= 0 {
		return fmt.Errorf("columns and rows must be positive")
	}
	if columns > maxTerminalDimension || rows > maxTerminalDimension {
		return fmt.Errorf("columns and rows must be less than or equal to %d", maxTerminalDimension)
	}
	sess := o.shellSessionLifecycle().get(sessionID)
	if sess == nil {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	sess.sizeQueue.Set(uint16(columns), uint16(rows))
	return nil
}

// CloseShellSession terminates an active shell session.
func (o *OperationsCoordinator) CloseShellSession(sessionID string) error {
	return o.shellSessionLifecycle().closeByUser(sessionID)
}

// ListShellSessions returns all active shell exec sessions.
func (o *OperationsCoordinator) ListShellSessions() []ShellSessionInfo {
	return o.shellSessionLifecycle().list()
}

// GetClusterShellSessionCount returns the number of active shell sessions for a cluster.
func (o *OperationsCoordinator) GetClusterShellSessionCount(clusterID string) int {
	return o.shellSessionLifecycle().countCluster(clusterID)
}

func runtimeOperationFromShellSession(sess *shellSession) RuntimeOperation {
	if sess == nil {
		return RuntimeOperation{}
	}
	return RuntimeOperation{
		ID:          sess.id,
		Type:        RuntimeOperationShell,
		ClusterID:   sess.clusterID,
		ClusterName: sess.clusterName,
		Target:      runtimeOperationTarget(sess.clusterID, podspkg.Identity.Group, podspkg.Identity.Version, podspkg.Identity.Kind, sess.namespace, sess.podName),
		Status:      "open",
		StartedAt:   sess.startedAt.Format(time.RFC3339),
		DisplayName: fmt.Sprintf("Shell %s/%s", sess.namespace, sess.podName),
		Summary: map[string]string{
			"container": sess.container,
			"command":   strings.Join(sess.command, " "),
		},
	}
}

// GetShellSessionBacklog returns buffered shell output for replaying on reattach.
func (o *OperationsCoordinator) GetShellSessionBacklog(sessionID string) (string, error) {
	sess := o.shellSessionLifecycle().get(sessionID)
	if sess == nil {
		return "", fmt.Errorf("shell session %q not found", sessionID)
	}
	return sess.snapshotBacklog(), nil
}

func hasContainer(containers []corev1.Container, name string) bool {
	for _, c := range containers {
		if c.Name == name {
			return true
		}
	}
	return false
}

func hasEphemeralContainer(containers []corev1.EphemeralContainer, name string) bool {
	for _, c := range containers {
		if c.Name == name {
			return true
		}
	}
	return false
}

// monitorShellTimeout watches for idle and max duration timeouts and terminates the session.
func (o *OperationsCoordinator) monitorShellTimeout(ctx context.Context, sess *shellSession) {
	// Check more frequently than the idle timeout to be responsive
	ticker := time.NewTicker(config.ShellSessionCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Check max duration first (hard limit)
			if sess.totalDuration() >= config.ShellSessionMaxDuration {
				if o.logger != nil {
					o.logger.Warn(fmt.Sprintf("Shell session %s exceeded max duration (%s), terminating", sess.id, config.ShellSessionMaxDuration), logsources.ShellSession)
				}
				o.terminateShellWithReason(sess.id, "timeout", "session exceeded maximum duration")
				return
			}

			// Check idle timeout
			if sess.idleDuration() >= config.ShellSessionIdleTimeout {
				if o.logger != nil {
					o.logger.Warn(fmt.Sprintf("Shell session %s idle for %s, terminating", sess.id, config.ShellSessionIdleTimeout), logsources.ShellSession)
				}
				o.terminateShellWithReason(sess.id, "timeout", "session idle timeout")
				return
			}
		}
	}
}

// terminateShellWithReason closes a shell session and emits a status with the given reason.
func (o *OperationsCoordinator) terminateShellWithReason(sessionID, status, reason string) {
	o.shellSessionLifecycle().terminate(sessionID, status, reason)
}
