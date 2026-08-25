package containerlogsstream

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
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

func boolPointer(value bool) *bool { return &value }

func TestParseRequestPreservesCompleteObjectIdentityAndFilters(t *testing.T) {
	options, err := parseRequest(Request{
		Scope:            "cluster-a|team-a:apps/v1:Deployment:api",
		Container:        "server",
		SelectedFilters:  []string{" running ", "", "init:setup"},
		PodInclude:       "api-",
		PodExclude:       "canary",
		Include:          "ready",
		Exclude:          "probe",
		ContainerState:   "running",
		TailLines:        250,
		IncludeInit:      boolPointer(false),
		IncludeEphemeral: boolPointer(false),
	})

	require.NoError(t, err)
	require.Equal(t, "cluster-a", options.ClusterID)
	require.Equal(t, "team-a", options.Namespace)
	require.Equal(t, "apps", options.Group)
	require.Equal(t, "v1", options.Version)
	require.Equal(t, "deployment", options.Kind)
	require.Equal(t, "api", options.Name)
	require.Equal(t, "server", options.Container)
	require.Equal(t, []string{"running", "init:setup"}, options.SelectedFilters)
	require.False(t, options.IncludeInit)
	require.False(t, options.IncludeEphemeral)
	require.Equal(t, 250, options.TailLines)
}

func TestParseRequestRequiresOneClusterAndVersionedNamespacedIdentity(t *testing.T) {
	for _, test := range []struct {
		name    string
		scope   string
		message string
	}{
		{name: "missing", message: "scope is required"},
		{name: "multiple clusters", scope: "cluster-a,cluster-b|team-a:/v1:Pod:api", message: "log scope requires a single cluster scope"},
		{name: "missing version", scope: "cluster-a|team-a:apps/:Deployment:api", message: "object apiVersion missing"},
		{name: "cluster scoped", scope: "cluster-a|:apps/v1:Deployment:api", message: "log scope must reference a namespaced object"},
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
	require.Equal(t, "scope is required", payload.Error)
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

	payloads := conn.waitForPayloads(t, 2)
	require.True(t, payloads[0].Reset)
	require.True(t, payloads[1].Reset)
	require.Equal(t, "cluster-a|team-a:/v1:Pod:api", payloads[0].Scope)
	require.Equal(t, uint64(1), payloads[0].Sequence)
	require.Equal(t, uint64(2), payloads[1].Sequence)

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

	payloads := conn.waitForPayloads(t, 3)
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
	require.Empty(t, payloads[0].Entries)
	require.True(t, payloads[1].Reset)
	require.Equal(t, "initial", payloads[1].Entries[0].Line)
	require.False(t, payloads[2].Reset)
	require.Equal(t, "update", payloads[2].Entries[0].Line)
	require.Equal(t, payloads[0].Sequence+1, payloads[1].Sequence)
	require.Equal(t, payloads[1].Sequence+1, payloads[2].Sequence)

	byTarget := map[string]telemetry.StreamStatus{}
	for _, status := range recorder.SnapshotSummary().Streams {
		if status.LeafKind == telemetry.StreamLeafTarget {
			byTarget[status.Leaf] = status
		}
	}
	require.Equal(t, telemetry.StreamContainerLogs, byTarget["default/stream-pod"].Name)
	require.GreaterOrEqual(t, byTarget["default/stream-pod"].TotalMessages, uint64(2))
}

func TestHandleEmitsPermissionDeniedPayload(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Resource: "pods"}, "", errors.New("forbidden"),
		)
	})
	handler, err := NewHandler(client, applog.Noop, telemetry.NewRecorder())
	require.NoError(t, err)
	conn := newNativeLogStreamConn()

	handler.Handle(context.Background(), conn, Request{
		Scope: "cluster-a|default:batch/v1:Job:my-job",
	})

	payloads := conn.waitForPayloads(t, 2)
	require.True(t, payloads[0].Reset)
	require.Empty(t, payloads[0].Error)
	require.NotEmpty(t, payloads[1].Error)
	require.NotNil(t, payloads[1].ErrorDetails)
	require.Equal(t, containerLogsDomain, payloads[1].ErrorDetails.Details.Domain)
	require.Equal(t, logPermissionResource, payloads[1].ErrorDetails.Details.Resource)
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

	require.Len(t, payloads[1].Entries, 1)
	require.Equal(t, "allowed", payloads[1].Entries[0].Line)
	require.NotNil(t, payloads[1].Warnings)
	require.Contains(t, (*payloads[1].Warnings)[0], "global limit of 1")
}

func TestHandleStopsWhenNativeStreamRejectsHandshakeOrInitialSnapshot(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "write-pod"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
	}
	for _, failAt := range []int{1, 2} {
		t.Run(strconv.Itoa(failAt), func(t *testing.T) {
			handler, err := NewHandler(fake.NewClientset(pod), applog.Noop, telemetry.NewRecorder())
			require.NoError(t, err)
			conn := newNativeLogStreamConn()
			conn.failAt = failAt

			handler.Handle(context.Background(), conn, Request{
				Scope: "cluster-a|default:/v1:Pod:write-pod", MatchNone: true,
			})

			conn.mu.Lock()
			defer conn.mu.Unlock()
			require.Equal(t, failAt, conn.sends)
		})
	}
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

func TestDeliveryBatchesEntriesAndReportsNativeSendFailure(t *testing.T) {
	conn := newNativeLogStreamConn()
	request := &containerLogsStream{
		handler: &Handler{}, conn: conn,
		options: Options{ScopeString: "cluster-a|team-a:/v1:Pod:api"}, sequence: 1,
	}
	delivery := newContainerLogsDelivery(request, nil)
	delivery.batch = []Entry{{Pod: "api", Container: "server", Line: "ready"}}
	require.False(t, delivery.flushBatch())
	require.Equal(t, "ready", conn.waitForPayloads(t, 1)[0].Entries[0].Line)

	conn.mu.Lock()
	conn.err = errors.New("stream closed")
	conn.mu.Unlock()
	delivery.batch = []Entry{{Line: "late"}}
	require.True(t, delivery.flushBatch())
}

func TestComposeStreamWarningsDistinguishesTransportDrops(t *testing.T) {
	warnings := composeStreamWarnings([]string{"selection warning"}, true)
	require.Equal(t, []string{"selection warning", transportDropWarning}, warnings)
	require.Equal(t, []string{"selection warning"}, composeStreamWarnings([]string{"selection warning"}, false))
}

func TestWarningClearPayloadEncodesAnEmptyArray(t *testing.T) {
	payload := EventPayload{
		Domain: containerLogsDomain, Scope: "cluster-a|default:/v1:Pod:web",
		Sequence: 2, GeneratedAt: 123, Warnings: warningPayload(nil, true),
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

func TestSplitTimestamp(t *testing.T) {
	timestamp, line := splitTimestamp("2024-01-02T15:04:05Z some message")
	require.NotEmpty(t, timestamp)
	require.Equal(t, "some message", line)
	timestamp, line = splitTimestamp("no-space-line")
	require.Empty(t, timestamp)
	require.Equal(t, "no-space-line", line)
}
