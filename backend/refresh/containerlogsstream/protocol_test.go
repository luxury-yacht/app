package containerlogsstream

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// logSession runs one handler session against a fake cluster with scripted
// log responses.
type logSession struct {
	logs   *logPods
	conn   *nativeLogStreamConn
	cancel context.CancelFunc
	done   chan struct{}
}

type sessionSetup struct {
	request Request
	objects []runtime.Object
	respond func(*corev1.PodLogOptions) logResponse
	prepare func(*fake.Clientset)
	// tune adjusts the streamer's timings.
	tune func(*Streamer)
}

func startLogSession(t *testing.T, setup sessionSetup) *logSession {
	t.Helper()
	baseClient := fake.NewClientset(setup.objects...)
	if setup.prepare != nil {
		setup.prepare(baseClient)
	}
	logs := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", nil)
	logs.responder = setup.respond
	client := &stubClient{Clientset: baseClient, core: &logCore{
		CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": logs},
	}}
	handler, err := NewHandler(client, applog.Noop, telemetry.NewRecorder())
	require.NoError(t, err)
	if setup.tune != nil {
		setup.tune(handler.streamer)
	}
	ctx, cancel := context.WithCancel(context.Background())
	session := &logSession{logs: logs, conn: newNativeLogStreamConn(), cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(session.done)
		handler.Handle(ctx, session.conn, setup.request)
	}()
	t.Cleanup(func() {
		cancel()
		<-session.done
	})
	return session
}

// snapshot collects frames up to and including the one that completes the
// snapshot.
func (s *logSession) snapshot(t *testing.T) []EventPayload {
	t.Helper()
	for count := 1; ; count++ {
		payloads := s.conn.waitForPayloads(t, count)
		if payloads[count-1].SnapshotComplete {
			return payloads
		}
	}
}

func (s *logSession) ended(t *testing.T) {
	t.Helper()
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
		t.Fatal("the stream did not close")
	}
}

func runningPod(name string, containers ...string) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: name, Labels: map[string]string{"app": "web"}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	for _, container := range containers {
		pod.Spec.Containers = append(pod.Spec.Containers, corev1.Container{Name: container})
		pod.Status.ContainerStatuses = append(pod.Status.ContainerStatuses, runningStatus(container, "containerd://"+name+"-"+container))
	}
	return pod
}

func entryLines(payloads []EventPayload) []string {
	var lines []string
	for _, payload := range payloads {
		for _, entry := range payload.Entries {
			lines = append(lines, entry.Line)
		}
	}
	return lines
}

func requireNoErrorFrame(t *testing.T, payloads []EventPayload) {
	t.Helper()
	for _, payload := range payloads {
		require.Empty(t, payload.Error, "a per-container problem must not fail the stream")
	}
}

// The frame budget must hold the longest line after worst-case JSON escaping,
// and stay within what Wails buffers for one window (streamOutQueueBytes,
// 8 MiB, in wails v3 pkg/application/stream.go).
func TestSnapshotFrameBudgetFitsTheLongestLine(t *testing.T) {
	longest := Entry{
		Timestamp: "2024-01-01T00:00:00.123456789Z",
		Pod:       strings.Repeat("p", 253),
		Container: strings.Repeat("c", 63),
		Line:      strings.Repeat("\x01", containerlogs.MaxLineBytes),
		IsInit:    true, IsEphemeral: true,
	}
	require.LessOrEqual(t, encodedEntrySize(longest), frameBudgetBytes)
	require.LessOrEqual(t, frameBudgetBytes, 8<<20)
}

func TestSnapshotLargerThanOneFrameArrivesCompleteAndInOrder(t *testing.T) {
	lines := make([]string, 12)
	offsets := make([]time.Duration, 12)
	for i := range lines {
		lines[i] = fmt.Sprintf("%02d %s", i, strings.Repeat("x", 200*1024))
		offsets[i] = time.Duration(i+1) * time.Millisecond
	}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 100},
		objects: []runtime.Object{runningPod("web-0", "app")},
		respond: func(*corev1.PodLogOptions) logResponse {
			return logResponse{body: buildContainerLogsStream(time.Unix(1000, 0), offsets, lines), holdOpen: true}
		},
	})

	frames := session.snapshot(t)
	require.Greater(t, len(frames), 1, "the snapshot should need more than one frame")
	for i, frame := range frames {
		require.Equal(t, i == 0, frame.Reset, "only the first frame resets")
		require.Equal(t, i == len(frames)-1, frame.SnapshotComplete, "only the last frame completes")
		size := 0
		for _, entry := range frame.Entries {
			size += encodedEntrySize(entry)
		}
		require.LessOrEqual(t, size, frameBudgetBytes)
	}
	require.Equal(t, lines, entryLines(frames))
}

// Each container reads at most the client's buffer size of history, and the
// snapshot keeps only the newest entries the buffer can hold.
func TestSnapshotKeepsTheNewestEntriesTheClientCanHold(t *testing.T) {
	respond := func(opts *corev1.PodLogOptions) logResponse {
		offsets, lines := []time.Duration{}, []string{}
		for i := range 4 {
			// Containers interleave: app writes at odd, sidecar at even milliseconds.
			step := 2*i + 1
			if opts.Container == "sidecar" {
				step++
			}
			offsets = append(offsets, time.Duration(step)*time.Millisecond)
			lines = append(lines, fmt.Sprintf("%s-%d", opts.Container, i))
		}
		return logResponse{body: buildContainerLogsStream(time.Unix(1000, 0), offsets, lines), holdOpen: true}
	}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 3},
		objects: []runtime.Object{runningPod("web-0", "app", "sidecar")},
		respond: respond,
	})

	frames := session.snapshot(t)
	require.Equal(t, []string{"sidecar-2", "app-3", "sidecar-3"}, entryLines(frames))
	require.Equal(t, 5, frames[len(frames)-1].Trimmed)
	session.logs.mu.Lock()
	defer session.logs.mu.Unlock()
	for _, tail := range session.logs.tailLines {
		require.NotNil(t, tail)
		require.Equal(t, int64(3), *tail, "each container's history is bounded by the client buffer")
	}
}

func TestSnapshotKeepsTheNewestEntriesWithinTheByteLimit(t *testing.T) {
	lines := []string{strings.Repeat("a", 100*1024), strings.Repeat("b", 100*1024), strings.Repeat("c", 100*1024)}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 100, MaxBytes: containerlogs.MaxLineBytes},
		objects: []runtime.Object{runningPod("web-0", "app")},
		respond: func(*corev1.PodLogOptions) logResponse {
			return logResponse{body: buildContainerLogsStream(time.Unix(1000, 0), []time.Duration{1, 2, 3}, lines), holdOpen: true}
		},
	})

	frames := session.snapshot(t)
	require.Equal(t, lines[1:], entryLines(frames))
	require.Equal(t, 1, frames[len(frames)-1].Trimmed)
}

// History that arrives after the snapshot is always sent, even when the
// snapshot already filled the client's buffer; the client decides what it keeps.
func TestLateHistoryAfterAFullSnapshotIsSent(t *testing.T) {
	reader, writer := io.Pipe()
	t.Cleanup(func() { _ = writer.Close() })
	origin := time.Unix(1000, 0)
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 2},
		objects: []runtime.Object{runningPod("web-0", "app", "slow")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "slow" {
				return logResponse{reader: reader}
			}
			return logResponse{body: buildContainerLogsStream(origin, []time.Duration{10 * time.Millisecond, 20 * time.Millisecond}, []string{"app-1", "app-2"}), holdOpen: true}
		},
	})
	frames := session.snapshot(t)
	require.Equal(t, []string{"app-1", "app-2"}, entryLines(frames))

	_, err := io.WriteString(writer, buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"slow-old"}))
	require.NoError(t, err)
	payloads := session.conn.waitForPayloads(t, len(frames)+1)
	require.Equal(t, []string{"slow-old"}, entryLines(payloads[len(frames):]))
}

// Entries lost to a full buffer are reported as one warning whose count grows.
func TestDeliveryReportsDroppedEntriesAsOneWarning(t *testing.T) {
	conn := newNativeLogStreamConn()
	request := &containerLogsStream{handler: &Handler{}, conn: conn, options: Options{ScopeString: "cluster-a|default:/v1:Pod:web"}, sequence: 1}
	pending := newPendingEntries(1, 1<<20)
	delivery := newContainerLogsDelivery(request, pending, newIssueSet(), nil)

	pending.add(Entry{Line: "kept"})
	pending.add(Entry{Line: "lost"})
	pending.add(Entry{Line: "lost"})
	require.False(t, delivery.flush())
	pending.add(Entry{Line: "kept again"})
	pending.add(Entry{Line: "lost"})
	require.False(t, delivery.flush())

	var last []containerlogs.Warning
	for _, payload := range conn.waitForPayloads(t, 4) {
		if payload.Warnings != nil {
			last = *payload.Warnings
		}
	}
	require.Equal(t, []containerlogs.Warning{{Kind: containerlogs.WarningDropped, Count: 3}}, last)
}

// A container on an unreachable node is listed as an issue while the others
// keep streaming.
func TestUnreachableContainerIsAnIssueWhileOthersStream(t *testing.T) {
	origin := time.Unix(1000, 0)
	reader, writer := io.Pipe()
	t.Cleanup(func() { _ = writer.Close() })
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0", MaxEntries: 100},
		objects: []runtime.Object{runningPod("web-0", "app", "sidecar")},
		respond: func(opts *corev1.PodLogOptions) logResponse {
			if opts.Container == "sidecar" {
				return logResponse{status: http.StatusInternalServerError, body: `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"dial tcp 10.0.0.9:10250: connect: connection refused","code":500}`}
			}
			return logResponse{reader: reader}
		},
	})
	_, err := io.WriteString(writer, buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"history"}))
	require.NoError(t, err)

	frames := session.snapshot(t)
	require.Equal(t, []string{"history"}, entryLines(frames))
	var issues []containerlogs.TargetIssue
	require.Eventually(t, func() bool {
		for _, payload := range session.conn.waitForPayloads(t, 1) {
			if payload.Issues != nil {
				issues = *payload.Issues
			}
		}
		return len(issues) == 1
	}, 3*time.Second, 20*time.Millisecond)
	require.Equal(t, "sidecar", issues[0].Container)
	require.Equal(t, containerlogs.IssueFailed, issues[0].State)
	require.Contains(t, issues[0].Reason, "connection refused")

	_, err = io.WriteString(writer, buildContainerLogsStream(origin, []time.Duration{2 * time.Millisecond}, []string{"live"}))
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		return strings.Contains(strings.Join(entryLines(session.conn.waitForPayloads(t, 1)), ","), "live")
	}, 3*time.Second, 20*time.Millisecond)
	requireNoErrorFrame(t, session.conn.waitForPayloads(t, 1))
}

func TestDeletedWorkloadEndsTheStreamWithAPermanentError(t *testing.T) {
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:apps/v1:Deployment:gone"},
	})

	session.ended(t)
	payloads := session.conn.waitForPayloads(t, 1)
	require.Len(t, payloads, 1)
	require.Contains(t, payloads[0].Error, "not found")
	require.False(t, payloads[0].Retryable)
}

func TestTransientResolveFailureIsRetryable(t *testing.T) {
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:batch/v1:Job:migrate"},
		prepare: func(client *fake.Clientset) {
			client.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
				return true, nil, apierrors.NewServiceUnavailable("apiserver is restarting")
			})
		},
	})

	session.ended(t)
	payload := session.conn.waitForPayloads(t, 1)[0]
	require.NotEmpty(t, payload.Error)
	require.True(t, payload.Retryable)
}

func forbidPods(verb string) func(*fake.Clientset) {
	return func(client *fake.Clientset) {
		client.PrependReactor(verb, "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(corev1.Resource("pods"), "", errors.New(`User "viewer" cannot `+verb+` resource "pods" in API group "" in the namespace "default"`))
		})
	}
}

func requirePodPermissionFailure(t *testing.T, payload EventPayload, verb string) {
	t.Helper()
	require.Contains(t, payload.Error, verb)
	require.False(t, payload.Retryable)
	require.NotNil(t, payload.ErrorDetails)
	require.Equal(t, "core/pods", payload.ErrorDetails.Details.Resource)
}

// Live logs for a workload need pods list; without it the stream fails
// permanently with a permission error naming the verb.
func TestWorkloadStreamWithoutPodListFailsWithAPermissionError(t *testing.T) {
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:batch/v1:Job:migrate"},
		prepare: forbidPods("list"),
	})

	session.ended(t)
	requirePodPermissionFailure(t, session.conn.waitForPayloads(t, 1)[0], "list")
}

// A single pod is read with get, but following it needs pods list and watch.
func TestPodStreamWithoutPodListFailsWithAPermissionError(t *testing.T) {
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:/v1:Pod:web-0"},
		objects: []runtime.Object{runningPod("web-0", "app")},
		respond: func(*corev1.PodLogOptions) logResponse { return logResponse{holdOpen: true} },
		prepare: forbidPods("list"),
	})

	session.ended(t)
	payloads := session.conn.waitForPayloads(t, 1)
	requirePodPermissionFailure(t, payloads[len(payloads)-1], "list")
}

// A pod that starts during the session raises the number of containers the
// target limit hides, and the tab's warning follows.
func TestTargetLimitWarningFollowsANewPod(t *testing.T) {
	selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}
	objects := []runtime.Object{&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}, Spec: appsv1.DeploymentSpec{Selector: selector}}}
	for i := range containerlogs.DefaultPerScopeTargetLimit + 2 {
		objects = append(objects, runningPod(fmt.Sprintf("web-%03d", i), "app"))
	}
	var client *fake.Clientset
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:apps/v1:Deployment:web"},
		objects: objects,
		respond: func(*corev1.PodLogOptions) logResponse { return logResponse{holdOpen: true} },
		prepare: func(c *fake.Clientset) { client = c },
	})
	session.snapshot(t)

	_, err := client.CoreV1().Pods("default").Create(context.Background(), runningPod("web-new", "app"), metav1.CreateOptions{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		session.conn.mu.Lock()
		defer session.conn.mu.Unlock()
		for _, payload := range session.conn.payloads {
			if payload.Warnings != nil && len(*payload.Warnings) == 1 && (*payload.Warnings)[0].Hidden == 3 {
				return true
			}
		}
		return false
	}, 5*time.Second, 10*time.Millisecond)
}

func TestDeploymentStreamReportsTheTargetLimitAsATypedWarning(t *testing.T) {
	selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}
	objects := []runtime.Object{&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}, Spec: appsv1.DeploymentSpec{Selector: selector}}}
	for i := range containerlogs.DefaultPerScopeTargetLimit + 2 {
		objects = append(objects, runningPod(fmt.Sprintf("web-%03d", i), "app"))
	}
	session := startLogSession(t, sessionSetup{
		request: Request{Scope: "cluster-a|default:apps/v1:Deployment:web"},
		objects: objects,
		respond: func(*corev1.PodLogOptions) logResponse { return logResponse{holdOpen: true} },
	})

	frames := session.snapshot(t)
	require.NotNil(t, frames[0].Warnings)
	require.Equal(t, []containerlogs.Warning{{
		Kind: containerlogs.WarningTargetLimit, Scope: containerlogs.LimitPerTab,
		Hidden: 2, Limit: containerlogs.DefaultPerScopeTargetLimit,
	}}, *frames[0].Warnings)
}
