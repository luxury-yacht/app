package containerlogsstream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

type nativeLogStreamConn struct {
	mu       sync.Mutex
	payloads []EventPayload
	err      error
	failAt   int
	sends    int
	notify   chan struct{}
}

func newNativeLogStreamConn() *nativeLogStreamConn {
	return &nativeLogStreamConn{notify: make(chan struct{}, 16)}
}

func (c *nativeLogStreamConn) SendJSON(value interface{}) error {
	payload, ok := value.(EventPayload)
	if !ok {
		return errors.New("unexpected container logs payload")
	}
	c.mu.Lock()
	c.sends++
	if c.err != nil || (c.failAt > 0 && c.sends == c.failAt) {
		err := c.err
		if err == nil {
			err = errors.New("stream closed")
		}
		c.mu.Unlock()
		return err
	}
	c.payloads = append(c.payloads, payload)
	c.mu.Unlock()
	c.notify <- struct{}{}
	return nil
}

func (c *nativeLogStreamConn) waitForPayloads(t *testing.T, count int) []EventPayload {
	t.Helper()
	deadline := time.After(4 * time.Second)
	for {
		c.mu.Lock()
		if len(c.payloads) >= count {
			payloads := append([]EventPayload(nil), c.payloads...)
			c.mu.Unlock()
			return payloads
		}
		c.mu.Unlock()
		select {
		case <-c.notify:
		case <-deadline:
			t.Fatalf("timed out waiting for %d container log payloads", count)
		}
	}
}

func TestParseRequestPreservesCompleteObjectIdentityAndSelection(t *testing.T) {
	options, err := parseRequest(Request{
		Scope:           "cluster-a|team-a:apps/v1:Deployment:api",
		SelectedFilters: []string{" pod:api-1 ", "", "init:setup"},
		MaxEntries:      250,
		MaxBytes:        10,
	})

	require.NoError(t, err)
	require.Equal(t, "cluster-a", options.ClusterID)
	require.Equal(t, "team-a", options.Namespace)
	require.Equal(t, "apps", options.Group)
	require.Equal(t, "v1", options.Version)
	require.Equal(t, "deployment", options.Kind)
	require.Equal(t, "api", options.Name)
	require.True(t, options.Selection.MatchPod("api-1"))
	require.False(t, options.Selection.MatchPod("api-2"))
	require.True(t, options.Selection.MatchContainer(containerlogs.ContainerRef{Name: "setup", IsInit: true}))
	require.False(t, options.Selection.MatchContainer(containerlogs.ContainerRef{Name: "setup"}))
	require.Equal(t, 250, options.MaxEntries)
	require.Equal(t, containerlogs.MaxLineBytes, options.MaxBytes, "the byte limit always holds one line")
}

func TestParseRequestBoundsTheClientBufferLimits(t *testing.T) {
	options, err := parseRequest(Request{Scope: "cluster-a|team-a:/v1:Pod:api", MaxEntries: 1_000_000, MaxBytes: 1 << 40})
	require.NoError(t, err)
	require.Equal(t, config.ContainerLogsStreamMaxTailLines, options.MaxEntries)
	require.Equal(t, config.ContainerLogsStreamMaxBytes, options.MaxBytes)

	options, err = parseRequest(Request{Scope: "cluster-a|team-a:/v1:Pod:api"})
	require.NoError(t, err)
	require.Equal(t, config.ContainerLogsStreamDefaultTailLines, options.MaxEntries)
	require.Equal(t, config.ContainerLogsStreamMaxBytes, options.MaxBytes)
}

func TestParseRequestRejectsMissingScopeAndMultipleClusters(t *testing.T) {
	for _, test := range []struct {
		name    string
		scope   string
		message string
	}{
		{name: "missing", message: "scope is required"},
		{name: "multiple clusters", scope: "cluster-a,cluster-b|team-a:/v1:Pod:api", message: "log scope requires a single cluster scope"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseRequest(Request{Scope: test.scope})
			require.ErrorContains(t, err, test.message)
		})
	}
}

func TestHandleSendsStructuredErrorForInvalidFirstFrame(t *testing.T) {
	handler := &Handler{}
	conn := newNativeLogStreamConn()

	handler.Handle(context.Background(), conn, Request{})

	payload := conn.waitForPayloads(t, 1)[0]
	require.Equal(t, containerLogsDomain, payload.Domain)
	require.Equal(t, uint64(1), payload.Sequence)
	require.Contains(t, payload.Error, "scope is required")
}

func TestHandleStreamsInitialResetAndStopsWithHandlerGeneration(t *testing.T) {
	handler, err := NewHandler(fake.NewSimpleClientset(), nil, nil)
	require.NoError(t, err)
	conn := newNativeLogStreamConn()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Handle(ctx, conn, Request{
			Scope: "cluster-a|team-a:/v1:Pod:api", MatchNone: true,
		})
	}()

	payload := conn.waitForPayloads(t, 1)[0]
	require.True(t, payload.Reset)
	require.True(t, payload.SnapshotComplete, "a match-none selection has an empty, complete snapshot")
	require.Empty(t, payload.Entries)
	require.Equal(t, "cluster-a|team-a:/v1:Pod:api", payload.Scope)
	require.Equal(t, uint64(1), payload.Sequence)

	handler.Stop()
	require.Eventually(t, func() bool {
		select {
		case <-done:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
	cancel()
}

func TestHandleStreamsInitialSnapshotAndUpdatesWithTelemetry(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "stream-pod"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{runningStatus("app", "containerd://a")}},
	}
	baseClient := fake.NewClientset(pod)
	origin := time.Unix(0, 0)
	override := newLogPods(baseClient.CoreV1().Pods("default"), "default", []string{
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"initial"}),
		buildContainerLogsStream(origin, []time.Duration{2 * time.Millisecond}, []string{"update"}),
	})
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{
			"default": override,
		}},
	}
	recorder := telemetry.NewRecorder()
	handler, err := NewHandler(client, applog.Noop, recorder)
	require.NoError(t, err)
	conn := newNativeLogStreamConn()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Handle(ctx, conn, Request{Scope: "cluster-a|default:/v1:Pod:stream-pod"})
	}()

	payloads := conn.waitForPayloads(t, 2)
	cancel()
	require.Eventually(t, func() bool {
		select {
		case <-done:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	require.True(t, payloads[0].Reset)
	require.True(t, payloads[0].SnapshotComplete)
	require.Equal(t, "initial", payloads[0].Entries[0].Line)
	require.False(t, payloads[1].Reset)
	require.Equal(t, "update", payloads[1].Entries[0].Line)
	require.Equal(t, payloads[0].Sequence+1, payloads[1].Sequence)

	byTarget := map[string]telemetry.StreamStatus{}
	for _, status := range recorder.SnapshotSummary().Streams {
		if status.LeafKind == telemetry.StreamLeafTarget {
			byTarget[status.Leaf] = status
		}
	}
	require.Equal(t, telemetry.StreamContainerLogs, byTarget["default/stream-pod"].Name)
	require.GreaterOrEqual(t, byTarget["default/stream-pod"].TotalMessages, uint64(2))
}

func TestHandleLimiterKeepsAllowedTargetAndWarns(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "limited-pod"},
		Spec: corev1.PodSpec{Containers: []corev1.Container{
			{Name: "app"}, {Name: "sidecar"},
		}},
	}
	baseClient := fake.NewClientset(pod)
	override := newLogPods(baseClient.CoreV1().Pods("default"), "default", []string{
		buildContainerLogsStream(time.Unix(0, 0), []time.Duration{time.Millisecond}, []string{"allowed"}),
	})
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{
			"default": override,
		}},
	}
	handler, err := NewHandler(client, applog.Noop, telemetry.NewRecorder(), NewGlobalTargetLimiter(1))
	require.NoError(t, err)
	conn := newNativeLogStreamConn()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Handle(ctx, conn, Request{Scope: "cluster-a|default:/v1:Pod:limited-pod"})
	}()

	payloads := conn.waitForPayloads(t, 1)
	cancel()
	require.Eventually(t, func() bool {
		select {
		case <-done:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	require.Len(t, payloads[0].Entries, 1)
	require.Equal(t, "allowed", payloads[0].Entries[0].Line)
	require.NotNil(t, payloads[0].Warnings)
	require.Equal(t, []containerlogs.Warning{{
		Kind: containerlogs.WarningTargetLimit, Scope: containerlogs.LimitGlobal, Hidden: 1, Limit: 1,
	}}, *payloads[0].Warnings)
}

func TestHandleStopsWhenTheClientRejectsTheSnapshot(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "write-pod"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	handler, err := NewHandler(fake.NewClientset(pod), applog.Noop, telemetry.NewRecorder())
	require.NoError(t, err)
	conn := newNativeLogStreamConn()
	conn.failAt = 1

	handler.Handle(context.Background(), conn, Request{
		Scope: "cluster-a|default:/v1:Pod:write-pod", MatchNone: true,
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	require.Equal(t, 1, conn.sends)
}

func TestStoppedHandlerRejectsSessionsThatStartAfterTeardown(t *testing.T) {
	handler, err := NewHandler(fake.NewSimpleClientset(), nil, nil)
	require.NoError(t, err)
	handler.Stop()

	conn := newNativeLogStreamConn()
	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		defer close(done)
		handler.Handle(ctx, conn, Request{
			Scope: "cluster-a|team-a:/v1:Pod:api", MatchNone: true,
		})
	}()

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		cancel()
		t.Fatal("session started after its handler generation was stopped")
	}
	conn.mu.Lock()
	defer conn.mu.Unlock()
	require.Empty(t, conn.payloads)
}

func TestDeliveryFlushesPendingEntriesAndReportsNativeSendFailure(t *testing.T) {
	conn := newNativeLogStreamConn()
	request := &containerLogsStream{
		handler: &Handler{}, conn: conn,
		options: Options{ScopeString: "cluster-a|team-a:/v1:Pod:api"}, sequence: 1,
	}
	pending := testPending()
	delivery := newContainerLogsDelivery(request, pending, newIssueSet(), nil)
	pending.add(Entry{Pod: "api", Container: "server", Line: "ready"})
	require.False(t, delivery.flush())
	require.Equal(t, "ready", conn.waitForPayloads(t, 1)[0].Entries[0].Line)

	conn.mu.Lock()
	conn.err = errors.New("stream closed")
	conn.mu.Unlock()
	pending.add(Entry{Line: "late"})
	require.True(t, delivery.flush())
}

func TestWarningClearPayloadEncodesAnEmptyArray(t *testing.T) {
	payload := EventPayload{
		Domain: containerLogsDomain, Scope: "cluster-a|default:/v1:Pod:web",
		Sequence: 2, GeneratedAt: 123, Warnings: listPayload[containerlogs.Warning](nil, true),
	}
	encoded, err := json.Marshal(payload)
	require.NoError(t, err)
	require.JSONEq(t, `{
		"domain":"container-logs",
		"scope":"cluster-a|default:/v1:Pod:web",
		"sequence":2,
		"generatedAt":123,
		"warnings":[]
	}`, string(encoded))
}

func twoContainerLogSession(t *testing.T, respond func(*corev1.PodLogOptions) logResponse) (*logPods, *nativeLogStreamConn, context.CancelFunc, <-chan struct{}) {
	t.Helper()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "two"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}, {Name: "sidecar"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	baseClient := fake.NewClientset(pod)
	override := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", nil)
	override.responder = respond
	client := &stubClient{Clientset: baseClient, core: &logCore{
		CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": override},
	}}
	handler, err := NewHandler(client, applog.Noop, telemetry.NewRecorder())
	require.NoError(t, err)
	conn := newNativeLogStreamConn()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Handle(ctx, conn, Request{Scope: "cluster-a|default:/v1:Pod:two"})
	}()
	return override, conn, cancel, done
}

// One follow request per container carries both history and live output, so
// live lines start as soon as a container's request opens.
func TestHandleOpensOneLogRequestPerContainer(t *testing.T) {
	origin := time.Unix(1000, 0)
	pods, conn, cancel, done := twoContainerLogSession(t, func(opts *corev1.PodLogOptions) logResponse {
		return logResponse{body: buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{opts.Container + " history"}), holdOpen: true}
	})
	defer func() { cancel(); <-done }()

	snapshot := conn.waitForPayloads(t, 1)[0]
	require.True(t, snapshot.Reset)
	lines := []string{}
	for _, entry := range snapshot.Entries {
		lines = append(lines, entry.Line)
	}
	require.ElementsMatch(t, []string{"app history", "sidecar history"}, lines)
	require.Equal(t, 1, pods.requestCount("app"))
	require.Equal(t, 1, pods.requestCount("sidecar"))
}

// A container whose kubelet never answers must not hold back the first
// snapshot or the other container's lines.
func TestHandleSnapshotDoesNotWaitForAHangingContainer(t *testing.T) {
	origin := time.Unix(1000, 0)
	_, conn, cancel, done := twoContainerLogSession(t, func(opts *corev1.PodLogOptions) logResponse {
		if opts.Container == "sidecar" {
			return logResponse{hang: true}
		}
		return logResponse{body: buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"app history"}), holdOpen: true}
	})
	defer func() { cancel(); <-done }()

	snapshot := conn.waitForPayloads(t, 1)[0]
	require.True(t, snapshot.Reset)
	require.Len(t, snapshot.Entries, 1)
	require.Equal(t, "app history", snapshot.Entries[0].Line)
}

// The snapshot merges containers in time order and keeps a burst that shares
// one timestamp in its written order.
func TestHandleSnapshotIsOrderedAcrossContainers(t *testing.T) {
	origin := time.Unix(1000, 0)
	_, conn, cancel, done := twoContainerLogSession(t, func(opts *corev1.PodLogOptions) logResponse {
		if opts.Container == "app" {
			burst := make([]time.Duration, 30)
			lines := make([]string, 30)
			for i := range burst {
				burst[i] = 2 * time.Millisecond
				lines[i] = fmt.Sprintf("trace-%02d", i)
			}
			return logResponse{body: buildContainerLogsStream(origin, burst, lines), holdOpen: true}
		}
		return logResponse{body: buildContainerLogsStream(origin, []time.Duration{time.Millisecond, 3 * time.Millisecond}, []string{"before", "after"}), holdOpen: true}
	})
	defer func() { cancel(); <-done }()

	snapshot := conn.waitForPayloads(t, 1)[0]
	lines := make([]string, 0, len(snapshot.Entries))
	for _, entry := range snapshot.Entries {
		lines = append(lines, entry.Line)
	}
	require.Len(t, lines, 32)
	require.Equal(t, "before", lines[0])
	for i := range 30 {
		require.Equal(t, fmt.Sprintf("trace-%02d", i), lines[i+1])
	}
	require.Equal(t, "after", lines[31])
}

// A line written after the history arrives once, in a batch soon after the
// snapshot (AC17).
func TestHandleDeliversALiveLineOnceAndPromptly(t *testing.T) {
	origin := time.Unix(1000, 0)
	reader, writer := io.Pipe()
	defer writer.Close()
	pods, conn, cancel, done := twoContainerLogSession(t, func(opts *corev1.PodLogOptions) logResponse {
		if opts.Container == "app" {
			return logResponse{reader: reader}
		}
		return logResponse{holdOpen: true}
	})
	defer func() { cancel(); <-done }()
	_, err := io.WriteString(writer, buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"history"}))
	require.NoError(t, err)

	snapshot := conn.waitForPayloads(t, 1)[0]
	require.Len(t, snapshot.Entries, 1)
	require.Equal(t, "history", snapshot.Entries[0].Line)

	written := time.Now()
	_, err = io.WriteString(writer, buildContainerLogsStream(origin, []time.Duration{2 * time.Millisecond}, []string{"live"}))
	require.NoError(t, err)
	batch := conn.waitForPayloads(t, 2)[1]
	require.Less(t, time.Since(written), time.Second)
	require.Equal(t, []string{"live"}, []string{batch.Entries[0].Line})
	require.Len(t, batch.Entries, 1)
	require.Equal(t, 1, pods.requestCount("app"))
}
