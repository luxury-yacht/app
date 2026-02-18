package backend

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

const (
	shellOutputEventName = "object-shell:output"
	shellStatusEventName = "object-shell:status"
	shellListEventName   = "object-shell:list"

	// shellIdleTimeout is the duration of inactivity after which a shell session is terminated.
	shellIdleTimeout = 30 * time.Minute

	// shellMaxDuration is the maximum lifetime of a shell session regardless of activity.
	shellMaxDuration = 8 * time.Hour

	// shellOutputBacklogMaxBytes bounds replay memory used per shell session.
	shellOutputBacklogMaxBytes = 256 * 1024
)

var (
	spdyExecutorFactory      = remotecommand.NewSPDYExecutor
	websocketExecutorFactory = remotecommand.NewWebSocketExecutor
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

	backlogMu    sync.Mutex
	backlog      []string
	backlogBytes int
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
	app       *App
	sessionID string
	clusterID string
	stream    string
	session   *shellSession
}

func (w *shellEventWriter) Write(p []byte) (int, error) {
	if len(p) == 0 || w.app == nil {
		return len(p), nil
	}
	chunk := string(p)
	if w.session != nil {
		w.session.touchActivity()
		w.session.appendBacklog(chunk)
	}
	w.app.emitShellOutput(w.sessionID, w.clusterID, w.stream, chunk)
	return len(p), nil
}

// StartShellSession launches a kubectl exec session and begins streaming data back to the frontend.
func (a *App) StartShellSession(clusterID string, req ShellSessionRequest) (*ShellSession, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	if deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	if deps.RestConfig == nil {
		return nil, fmt.Errorf("kubernetes rest config not initialized")
	}
	if req.Namespace == "" {
		return nil, fmt.Errorf("namespace is required")
	}
	if req.PodName == "" {
		return nil, fmt.Errorf("pod name is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	podIdentifier := fmt.Sprintf("%s/%s", req.Namespace, req.PodName)
	pod, err := executeWithRetry(ctx, a, clusterID, "pod-shell", podIdentifier, func() (*corev1.Pod, error) {
		return deps.KubernetesClient.CoreV1().Pods(req.Namespace).Get(ctx, req.PodName, metav1.GetOptions{})
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load pod: %w", err)
	}
	if len(pod.Spec.Containers) == 0 && len(pod.Spec.EphemeralContainers) == 0 {
		return nil, fmt.Errorf("pod has no containers available for exec")
	}

	container := req.Container
	if container == "" {
		if len(pod.Spec.Containers) > 0 {
			container = pod.Spec.Containers[0].Name
		} else {
			// Pods normally have regular containers, but allow ephemeral-only fallback.
			container = pod.Spec.EphemeralContainers[0].Name
		}
	}
	if !hasContainer(pod.Spec.Containers, container) && !hasEphemeralContainer(pod.Spec.EphemeralContainers, container) {
		return nil, fmt.Errorf("container %q not found in pod %s", container, req.PodName)
	}

	command := req.Command
	if len(command) == 0 {
		command = []string{"/bin/sh"}
	}

	sessionID := uuid.NewString()
	stdinReader, stdinWriter := io.Pipe()
	sizeQueue := newTerminalSizeQueue()
	sizeQueue.Set(120, 40)

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

	websocketExec, err := websocketExecutorFactory(deps.RestConfig, http.MethodGet, execReq.URL().String())
	if err != nil {
		return nil, fmt.Errorf("failed to create websocket executor: %w", err)
	}
	spdyExecutor, err := spdyExecutorFactory(deps.RestConfig, http.MethodPost, execReq.URL())
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

	sessionCtx, sessionCancel := context.WithCancel(context.Background())
	now := time.Now()
	sess := &shellSession{
		id:           sessionID,
		clusterID:    clusterID,
		clusterName:  deps.ClusterName,
		namespace:    req.Namespace,
		podName:      req.PodName,
		container:    container,
		command:      append([]string(nil), command...),
		stdin:        stdinWriter,
		stdinR:       stdinReader,
		sizeQueue:    sizeQueue,
		cancel:       sessionCancel,
		startedAt:    now,
		lastActivity: now,
	}
	if sess.clusterName == "" {
		sess.clusterName = clusterID
	}

	a.shellSessionsMu.Lock()
	a.shellSessions[sessionID] = sess
	a.shellSessionsMu.Unlock()
	a.emitShellList()

	// Start timeout monitor goroutine
	go a.monitorShellTimeout(sessionCtx, sess)

	go func() {
		defer func() {
			sess.Close()
			if a.removeShellSession(sessionID) != nil {
				a.emitShellList()
			}
		}()

		streamErr := executor.StreamWithContext(sessionCtx, remotecommand.StreamOptions{
			Stdin:             stdinReader,
			Stdout:            &shellEventWriter{app: a, sessionID: sessionID, clusterID: clusterID, stream: "stdout", session: sess},
			Stderr:            &shellEventWriter{app: a, sessionID: sessionID, clusterID: clusterID, stream: "stderr", session: sess},
			Tty:               true,
			TerminalSizeQueue: sizeQueue,
		})

		if streamErr != nil {
			a.emitShellStatus(sessionID, clusterID, "error", streamErr.Error())
		} else {
			a.emitShellStatus(sessionID, clusterID, "closed", "")
		}
	}()

	a.emitShellStatus(sessionID, clusterID, "open", "")

	containers := make([]string, 0, len(pod.Spec.Containers)+len(pod.Spec.EphemeralContainers))
	for _, c := range pod.Spec.Containers {
		containers = append(containers, c.Name)
	}
	for _, c := range pod.Spec.EphemeralContainers {
		containers = append(containers, c.Name)
	}

	return &ShellSession{
		SessionID:  sessionID,
		Namespace:  req.Namespace,
		PodName:    req.PodName,
		Container:  container,
		Command:    command,
		Containers: containers,
	}, nil
}

// SendShellInput writes stdin data to an active exec session.
func (a *App) SendShellInput(sessionID string, data string) error {
	if data == "" {
		return nil
	}
	sess := a.getShellSession(sessionID)
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
func (a *App) ResizeShellSession(sessionID string, columns, rows int) error {
	if columns <= 0 || rows <= 0 {
		return fmt.Errorf("columns and rows must be positive")
	}
	sess := a.getShellSession(sessionID)
	if sess == nil {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	sess.sizeQueue.Set(uint16(columns), uint16(rows))
	return nil
}

// CloseShellSession terminates an active shell session.
func (a *App) CloseShellSession(sessionID string) error {
	sess := a.removeShellSession(sessionID)
	if sess == nil {
		return fmt.Errorf("shell session %q not found", sessionID)
	}
	sess.Close()
	a.emitShellStatus(sessionID, sess.clusterID, "closed", "terminated")
	a.emitShellList()
	return nil
}

// ListShellSessions returns all active shell exec sessions.
func (a *App) ListShellSessions() []ShellSessionInfo {
	a.shellSessionsMu.Lock()
	defer a.shellSessionsMu.Unlock()

	sessions := make([]ShellSessionInfo, 0, len(a.shellSessions))
	for _, sess := range a.shellSessions {
		sessions = append(sessions, ShellSessionInfo{
			SessionID:   sess.id,
			ClusterID:   sess.clusterID,
			ClusterName: sess.clusterName,
			Namespace:   sess.namespace,
			PodName:     sess.podName,
			Container:   sess.container,
			Command:     append([]string(nil), sess.command...),
			StartedAt:   metav1.NewTime(sess.startedAt),
		})
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.Before(&sessions[j].StartedAt)
	})
	return sessions
}

// GetClusterShellSessionCount returns the number of active shell sessions for a cluster.
func (a *App) GetClusterShellSessionCount(clusterID string) int {
	a.shellSessionsMu.Lock()
	defer a.shellSessionsMu.Unlock()

	count := 0
	for _, sess := range a.shellSessions {
		if sess.clusterID == clusterID {
			count++
		}
	}
	return count
}

// StopClusterShellSessions terminates all shell sessions for a specific cluster.
func (a *App) StopClusterShellSessions(clusterID string) error {
	a.shellSessionsMu.Lock()
	toStop := make([]*shellSession, 0)
	for _, sess := range a.shellSessions {
		if sess.clusterID == clusterID {
			toStop = append(toStop, sess)
			delete(a.shellSessions, sess.id)
		}
	}
	a.shellSessionsMu.Unlock()

	for _, sess := range toStop {
		sess.Close()
		a.emitShellStatus(sess.id, sess.clusterID, "closed", "cluster disconnected")
	}
	if len(toStop) > 0 {
		a.emitShellList()
	}
	return nil
}

// GetShellSessionBacklog returns buffered shell output for replaying on reattach.
func (a *App) GetShellSessionBacklog(sessionID string) (string, error) {
	sess := a.getShellSession(sessionID)
	if sess == nil {
		return "", fmt.Errorf("shell session %q not found", sessionID)
	}
	return sess.snapshotBacklog(), nil
}

func (a *App) getShellSession(sessionID string) *shellSession {
	a.shellSessionsMu.Lock()
	defer a.shellSessionsMu.Unlock()
	return a.shellSessions[sessionID]
}

func (a *App) removeShellSession(sessionID string) *shellSession {
	a.shellSessionsMu.Lock()
	defer a.shellSessionsMu.Unlock()
	sess, ok := a.shellSessions[sessionID]
	if ok {
		delete(a.shellSessions, sessionID)
	}
	return sess
}

func (a *App) emitShellOutput(sessionID, clusterID, stream, data string) {
	if sessionID == "" || data == "" {
		return
	}
	a.emitEvent(shellOutputEventName, ShellOutputEvent{
		SessionID: sessionID,
		ClusterID: clusterID,
		Stream:    stream,
		Data:      data,
	})
}

func (a *App) emitShellStatus(sessionID, clusterID, status, reason string) {
	if sessionID == "" || status == "" {
		return
	}
	a.emitEvent(shellStatusEventName, ShellStatusEvent{
		SessionID: sessionID,
		ClusterID: clusterID,
		Status:    status,
		Reason:    reason,
	})
}

func (a *App) emitShellList() {
	a.emitEvent(shellListEventName, a.ListShellSessions())
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
func (a *App) monitorShellTimeout(ctx context.Context, sess *shellSession) {
	// Check more frequently than the idle timeout to be responsive
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Check max duration first (hard limit)
			if sess.totalDuration() >= shellMaxDuration {
				a.logger.Warn(fmt.Sprintf("Shell session %s exceeded max duration (%s), terminating", sess.id, shellMaxDuration), "ShellSession")
				a.terminateShellWithReason(sess.id, "timeout", "session exceeded maximum duration")
				return
			}

			// Check idle timeout
			if sess.idleDuration() >= shellIdleTimeout {
				a.logger.Warn(fmt.Sprintf("Shell session %s idle for %s, terminating", sess.id, shellIdleTimeout), "ShellSession")
				a.terminateShellWithReason(sess.id, "timeout", "session idle timeout")
				return
			}
		}
	}
}

// terminateShellWithReason closes a shell session and emits a status with the given reason.
func (a *App) terminateShellWithReason(sessionID, status, reason string) {
	sess := a.removeShellSession(sessionID)
	if sess == nil {
		return
	}
	sess.Close()
	a.emitShellStatus(sessionID, sess.clusterID, status, reason)
	a.emitShellList()
}
