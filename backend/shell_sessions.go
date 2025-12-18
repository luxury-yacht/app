package backend

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

const (
	shellOutputEventName = "object-shell:output"
	shellStatusEventName = "object-shell:status"

	// shellIdleTimeout is the duration of inactivity after which a shell session is terminated.
	shellIdleTimeout = 30 * time.Minute

	// shellMaxDuration is the maximum lifetime of a shell session regardless of activity.
	shellMaxDuration = 8 * time.Hour
)

var spdyExecutorFactory = remotecommand.NewSPDYExecutor

type shellSession struct {
	id        string
	namespace string
	podName   string
	container string
	stdin     *io.PipeWriter
	stdinR    *io.PipeReader
	sizeQueue *terminalSizeQueue
	cancel    context.CancelFunc
	once      sync.Once

	activityMu   sync.Mutex
	lastActivity time.Time
	startedAt    time.Time
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
	stream    string
	session   *shellSession
}

func (w *shellEventWriter) Write(p []byte) (int, error) {
	if len(p) == 0 || w.app == nil {
		return len(p), nil
	}
	if w.session != nil {
		w.session.touchActivity()
	}
	w.app.emitShellOutput(w.sessionID, w.stream, string(p))
	return len(p), nil
}

// StartShellSession launches a kubectl exec session and begins streaming data back to the frontend.
func (a *App) StartShellSession(req ShellSessionRequest) (*ShellSession, error) {
	if err := a.ensureClientInitialized("pod-shell"); err != nil {
		return nil, err
	}
	if a.restConfig == nil {
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
	pod, err := executeWithRetry(ctx, a, "pod-shell", podIdentifier, func() (*corev1.Pod, error) {
		return a.client.CoreV1().Pods(req.Namespace).Get(ctx, req.PodName, metav1.GetOptions{})
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load pod: %w", err)
	}
	if len(pod.Spec.Containers) == 0 {
		return nil, fmt.Errorf("pod has no containers available for exec")
	}

	container := req.Container
	if container == "" {
		container = pod.Spec.Containers[0].Name
	}
	if !hasContainer(pod.Spec.Containers, container) {
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

	execReq := a.client.CoreV1().
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

	executor, err := spdyExecutorFactory(a.restConfig, http.MethodPost, execReq.URL())
	if err != nil {
		return nil, fmt.Errorf("failed to build exec session: %w", err)
	}

	sessionCtx, sessionCancel := context.WithCancel(context.Background())
	now := time.Now()
	sess := &shellSession{
		id:           sessionID,
		namespace:    req.Namespace,
		podName:      req.PodName,
		container:    container,
		stdin:        stdinWriter,
		stdinR:       stdinReader,
		sizeQueue:    sizeQueue,
		cancel:       sessionCancel,
		startedAt:    now,
		lastActivity: now,
	}

	a.shellSessionsMu.Lock()
	a.shellSessions[sessionID] = sess
	a.shellSessionsMu.Unlock()

	// Start timeout monitor goroutine
	go a.monitorShellTimeout(sessionCtx, sess)

	go func() {
		defer func() {
			sess.Close()
			a.removeShellSession(sessionID)
		}()

		streamErr := executor.StreamWithContext(sessionCtx, remotecommand.StreamOptions{
			Stdin:             stdinReader,
			Stdout:            &shellEventWriter{app: a, sessionID: sessionID, stream: "stdout", session: sess},
			Stderr:            &shellEventWriter{app: a, sessionID: sessionID, stream: "stderr", session: sess},
			Tty:               true,
			TerminalSizeQueue: sizeQueue,
		})

		if streamErr != nil {
			a.emitShellStatus(sessionID, "error", streamErr.Error())
		} else {
			a.emitShellStatus(sessionID, "closed", "")
		}
	}()

	a.emitShellStatus(sessionID, "open", "")

	containers := make([]string, 0, len(pod.Spec.Containers))
	for _, c := range pod.Spec.Containers {
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
	a.emitShellStatus(sessionID, "closed", "terminated")
	return nil
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

func (a *App) emitShellOutput(sessionID, stream, data string) {
	if sessionID == "" || data == "" {
		return
	}
	a.emitEvent(shellOutputEventName, ShellOutputEvent{
		SessionID: sessionID,
		Stream:    stream,
		Data:      data,
	})
}

func (a *App) emitShellStatus(sessionID, status, reason string) {
	if sessionID == "" || status == "" {
		return
	}
	a.emitEvent(shellStatusEventName, ShellStatusEvent{
		SessionID: sessionID,
		Status:    status,
		Reason:    reason,
	})
}

func hasContainer(containers []corev1.Container, name string) bool {
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
	a.emitShellStatus(sessionID, status, reason)
}
