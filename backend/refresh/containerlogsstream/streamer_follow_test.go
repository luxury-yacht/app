package containerlogsstream

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	kubescheme "k8s.io/client-go/kubernetes/scheme"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	restclient "k8s.io/client-go/rest"
	fakerest "k8s.io/client-go/rest/fake"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestFollowContainerStreamsBatches(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "my-pod", corev1.PodRunning)

	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	streams := []string{
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond, 2 * time.Millisecond}, []string{"first", "second"}),
		buildContainerLogsStream(origin, []time.Duration{2 * time.Millisecond, 3 * time.Millisecond}, []string{"second", "third"}),
	}

	podsOverride := newLogPods(delegateCore.Pods("default"), "default", streams)
	coreOverride := &logCore{
		CoreV1Interface: delegateCore,
		overrides: map[string]*logPods{
			"default": podsOverride,
		},
	}

	client := &stubClient{
		Clientset: baseClient,
		core:      coreOverride,
	}

	streamer := NewStreamer(client, applog.Noop, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	target := containerTarget{
		namespace: "default",
		pod:       "my-pod",
		container: "app",
		state:     &containerState{},
	}

	entriesCh := make(chan Entry, 10)
	errCh := make(chan error, 1)
	dropCh := make(chan int, 10)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, containerlogs.LineFilter{}, entriesCh, errCh, dropCh)
		close(done)
	}()

	var entries []Entry
	timeout := time.After(4 * time.Second)
	for len(entries) < 3 {
		select {
		case entry := <-entriesCh:
			entries = append(entries, entry)
		case err := <-errCh:
			t.Fatalf("unexpected error from followContainer: %v", err)
		case drop := <-dropCh:
			t.Fatalf("unexpected backlog drop reported: %d", drop)
		case <-timeout:
			t.Fatalf("timed out waiting for log entries (got %d)", len(entries))
		}
	}

	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("followContainer did not exit after context cancellation")
	}

	lines := []string{entries[0].Line, entries[1].Line, entries[2].Line}
	require.Equal(t, []string{"first", "second", "third"}, lines, "deduplication should skip repeated line from reconnect")

	require.Len(t, podsOverride.sinceTimes, 2)
	require.Nil(t, podsOverride.sinceTimes[0])
	require.NotNil(t, podsOverride.sinceTimes[1])

	expectedSince := origin.Add(2 * time.Millisecond)
	require.True(t, podsOverride.sinceTimes[1].Time.Equal(expectedSince), "second stream should start from last timestamp")
}

func TestFollowContainerRecordsDroppedTelemetry(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "drop-pod", corev1.PodRunning)

	delegateCore := baseClient.CoreV1()
	streams := []string{
		buildContainerLogsStream(time.Unix(0, 0), []time.Duration{time.Millisecond}, []string{"first"}),
	}

	podsOverride := newLogPods(delegateCore.Pods("default"), "default", streams)
	coreOverride := &logCore{
		CoreV1Interface: delegateCore,
		overrides: map[string]*logPods{
			"default": podsOverride,
		},
	}

	client := &stubClient{
		Clientset: baseClient,
		core:      coreOverride,
	}

	recorder := telemetry.NewRecorder()
	streamer := NewStreamer(client, applog.Noop, recorder)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	target := containerTarget{
		namespace: "default",
		pod:       "drop-pod",
		container: "app",
		state:     &containerState{},
	}

	entriesCh := make(chan Entry) // unbuffered to force drop
	errCh := make(chan error, 1)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, containerlogs.LineFilter{}, entriesCh, errCh, nil)
		close(done)
	}()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("unexpected error during follow: %v", err)
		}
	case <-time.After(50 * time.Millisecond):
	}

	time.Sleep(20 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("followContainer did not exit after cancel")
	}

	summary := recorder.SnapshotSummary()
	require.Len(t, summary.Streams, 1)
	status := summary.Streams[0]
	require.Equal(t, telemetry.StreamContainerLogs, status.Name)
	require.EqualValues(t, 0, status.TotalMessages)
	require.Greater(t, status.DroppedMessages, uint64(0))
	require.Equal(t, "subscriber backlog", status.LastError)
	require.Greater(t, status.ErrorCount, uint64(0))
}

func TestFollowContainerRetriesAfterStreamFailure(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "retry-pod", corev1.PodRunning)
	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	responses := []logResponse{
		{status: http.StatusInternalServerError, body: "error"},
		{status: http.StatusOK, body: buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"line"})},
	}
	podsOverride := newLogPodsWithResponses(delegateCore.Pods("default"), "default", responses)
	coreOverride := &logCore{
		CoreV1Interface: delegateCore,
		overrides: map[string]*logPods{
			"default": podsOverride,
		},
	}
	client := &stubClient{
		Clientset: baseClient,
		core:      coreOverride,
	}

	streamer := NewStreamer(client, applog.Noop, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	target := containerTarget{
		namespace: "default",
		pod:       "retry-pod",
		container: "app",
		state:     &containerState{},
	}

	entriesCh := make(chan Entry, 1)
	errCh := make(chan error, 1)
	dropCh := make(chan int, 1)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, containerlogs.LineFilter{}, entriesCh, errCh, dropCh)
		close(done)
	}()

	select {
	case err := <-errCh:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("expected initial error from followContainer")
	}

	select {
	case entry := <-entriesCh:
		require.Equal(t, "line", entry.Line)
	case <-time.After(3 * time.Second):
		t.Fatal("expected log entry after retry")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("followContainer did not exit after context cancellation")
	}
}

func TestFollowContainerStopsOnNotFoundWithoutUserFacingError(t *testing.T) {
	baseClient := fake.NewClientset()
	delegateCore := baseClient.CoreV1()
	podsOverride := newLogPodsWithResponses(delegateCore.Pods("default"), "default", []logResponse{{
		status: http.StatusNotFound,
		body:   `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}`,
	}})
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{CoreV1Interface: delegateCore, overrides: map[string]*logPods{
			"default": podsOverride,
		}},
	}
	streamer := NewStreamer(client, applog.Noop, nil)
	errCh := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		streamer.followContainer(
			context.Background(),
			containerTarget{namespace: "default", pod: "gone", container: "app"},
			containerlogs.LineFilter{},
			make(chan Entry, 1),
			errCh,
			make(chan int, 1),
		)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("NotFound should stop the follower without reconnect backoff")
	}
	select {
	case err := <-errCh:
		t.Fatalf("NotFound should not emit a user-facing stream error: %v", err)
	default:
	}
}

func TestFollowContainerFiltersLinesAndAccountsForFullDropChannel(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "busy-pod", corev1.PodRunning)
	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	podsOverride := newLogPods(delegateCore.Pods("default"), "default", []string{
		buildContainerLogsStream(
			origin,
			[]time.Duration{time.Millisecond, 2 * time.Millisecond, 3 * time.Millisecond},
			[]string{"info ignored", "error first", "error second"},
		),
	})
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{CoreV1Interface: delegateCore, overrides: map[string]*logPods{
			"default": podsOverride,
		}},
	}
	recorder := telemetry.NewRecorder()
	streamer := NewStreamer(client, applog.Noop, recorder)
	filter, err := containerlogs.NewLineFilter("error", "")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	dropCh := make(chan int, 1)
	done := make(chan struct{})
	go func() {
		streamer.followContainer(
			ctx,
			containerTarget{namespace: "default", pod: "busy-pod", container: "app"},
			filter,
			make(chan Entry),
			make(chan error, 1),
			dropCh,
		)
		close(done)
	}()

	require.Eventually(t, func() bool {
		return len(dropCh) == 1
	}, time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool {
		for _, status := range recorder.SnapshotSummary().Streams {
			if status.Name == telemetry.StreamContainerLogs && status.DroppedMessages > 0 {
				return true
			}
		}
		return false
	}, time.Second, 10*time.Millisecond, "overflowing the drop channel must still reach telemetry")
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("busy follower did not stop after cancellation")
	}
}

func TestFollowContainerPreCancelledContextDoesNotOpenStream(t *testing.T) {
	baseClient := fake.NewClientset()
	delegateCore := baseClient.CoreV1()
	podsOverride := newLogPods(delegateCore.Pods("default"), "default", nil)
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{CoreV1Interface: delegateCore, overrides: map[string]*logPods{
			"default": podsOverride,
		}},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	NewStreamer(client, applog.Noop, nil).followContainer(
		ctx,
		containerTarget{namespace: "default", pod: "never-opened", container: "app"},
		containerlogs.LineFilter{},
		make(chan Entry),
		make(chan error),
		make(chan int),
	)
	require.Zero(t, podsOverride.containerRequestCount("app"))
}

func TestFollowContainerClosesCompletedStreamExactlyOnce(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "completed-pod", corev1.PodSucceeded)
	delegateCore := baseClient.CoreV1()
	closeCalls := 0
	podsOverride := newLogPodsWithResponses(delegateCore.Pods("default"), "default", []logResponse{{
		status:  http.StatusOK,
		body:    buildContainerLogsStream(time.Unix(0, 0), []time.Duration{time.Millisecond}, []string{"final"}),
		onClose: func() { closeCalls++ },
	}})
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{CoreV1Interface: delegateCore, overrides: map[string]*logPods{
			"default": podsOverride,
		}},
	}
	entries := make(chan Entry, 1)
	NewStreamer(client, applog.Noop, nil).followContainer(
		context.Background(),
		containerTarget{namespace: "default", pod: "completed-pod", container: "app"},
		containerlogs.LineFilter{},
		entries,
		make(chan error, 1),
		make(chan int, 1),
	)
	require.Equal(t, 1, closeCalls)
	require.Equal(t, "final", (<-entries).Line)
}

func TestFollowContainerStopsAfterInitCompletes(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "my-pod", corev1.PodRunning)

	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	streams := []string{
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"init-line"}),
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"duplicate"}),
	}
	podsOverride := newLogPods(delegateCore.Pods("default"), "default", streams)
	coreOverride := &logCore{
		CoreV1Interface: delegateCore,
		overrides: map[string]*logPods{
			"default": podsOverride,
		},
	}

	client := &stubClient{
		Clientset: baseClient,
		core:      coreOverride,
	}

	streamer := NewStreamer(client, applog.Noop, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	target := containerTarget{
		namespace: "default",
		pod:       "my-pod",
		container: "init",
		isInit:    true,
		state:     &containerState{},
	}

	entriesCh := make(chan Entry, 5)
	errCh := make(chan error, 1)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, containerlogs.LineFilter{}, entriesCh, errCh, nil)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("followContainer did not exit for init container")
	}

	require.Len(t, podsOverride.sinceTimes, 1, "init containers should not reopen container logs streams")
	select {
	case entry := <-entriesCh:
		require.Equal(t, "init-line", entry.Line)
	default:
		t.Fatal("expected init log entry")
	}
}

// TestFollowContainerDeduplicatesMultipleLinesAtSameTimestamp verifies that when multiple
// different log lines share the same timestamp, they are not duplicated on stream reconnection.
// This tests a bug where Java applications emit multiple lines at the same millisecond timestamp,
// and on reconnection (using SinceTime), all lines at that timestamp are returned again.
func TestFollowContainerDeduplicatesMultipleLinesAtSameTimestamp(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "java-pod", corev1.PodRunning)

	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)

	// Simulate Java app emitting multiple lines at the same timestamp
	sameTime := time.Millisecond
	// Stream 1: Initial batch with 4 lines at the same timestamp
	// Stream 2: Reconnection returns all lines from that timestamp (SinceTime is inclusive)
	streams := []string{
		buildContainerLogsStream(origin, []time.Duration{sameTime, sameTime, sameTime, sameTime}, []string{
			"WARNING: A Java agent has been loaded",
			"WARNING: If a serviceability tool is in use",
			"WARNING: If a serviceability tool is not in use",
			"WARNING: Dynamic loading will be disallowed",
		}),
		// On reconnection, Kubernetes returns all lines from SinceTime (inclusive)
		buildContainerLogsStream(origin, []time.Duration{sameTime, sameTime, sameTime, sameTime, 2 * sameTime}, []string{
			"WARNING: A Java agent has been loaded",
			"WARNING: If a serviceability tool is in use",
			"WARNING: If a serviceability tool is not in use",
			"WARNING: Dynamic loading will be disallowed",
			"INFO: New line after reconnect",
		}),
	}

	podsOverride := newLogPods(delegateCore.Pods("default"), "default", streams)
	coreOverride := &logCore{
		CoreV1Interface: delegateCore,
		overrides: map[string]*logPods{
			"default": podsOverride,
		},
	}

	client := &stubClient{
		Clientset: baseClient,
		core:      coreOverride,
	}

	streamer := NewStreamer(client, applog.Noop, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	target := containerTarget{
		namespace: "default",
		pod:       "java-pod",
		container: "app",
		state:     &containerState{},
	}

	entriesCh := make(chan Entry, 20)
	errCh := make(chan error, 1)
	dropCh := make(chan int, 10)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, containerlogs.LineFilter{}, entriesCh, errCh, dropCh)
		close(done)
	}()

	// Expect exactly 5 unique lines: 4 from initial batch + 1 new line after reconnect
	// NOT 9 lines (4 original + 4 duplicates + 1 new)
	var entries []Entry
	timeout := time.After(4 * time.Second)
	for len(entries) < 5 {
		select {
		case entry := <-entriesCh:
			entries = append(entries, entry)
		case err := <-errCh:
			t.Fatalf("unexpected error from followContainer: %v", err)
		case drop := <-dropCh:
			t.Fatalf("unexpected backlog drop reported: %d", drop)
		case <-timeout:
			t.Fatalf("timed out waiting for log entries (got %d)", len(entries))
		}
	}

	// Give a small window for any extra (duplicate) entries to arrive
	extraTimeout := time.After(100 * time.Millisecond)
extraLoop:
	for {
		select {
		case entry := <-entriesCh:
			entries = append(entries, entry)
		case <-extraTimeout:
			break extraLoop
		}
	}

	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("followContainer did not exit after context cancellation")
	}

	// Extract just the line content for comparison
	lines := make([]string, len(entries))
	for i, e := range entries {
		lines[i] = e.Line
	}

	expected := []string{
		"WARNING: A Java agent has been loaded",
		"WARNING: If a serviceability tool is in use",
		"WARNING: If a serviceability tool is not in use",
		"WARNING: Dynamic loading will be disallowed",
		"INFO: New line after reconnect",
	}
	require.Equal(t, expected, lines, "deduplication should skip all lines at same timestamp that were already seen")
}

func TestFollowContainerStopsWhenPodTerminated(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "done-pod", corev1.PodSucceeded)

	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	streams := []string{
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"final"}),
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"duplicate"}),
	}
	podsOverride := newLogPods(delegateCore.Pods("default"), "default", streams)
	coreOverride := &logCore{
		CoreV1Interface: delegateCore,
		overrides: map[string]*logPods{
			"default": podsOverride,
		},
	}

	client := &stubClient{
		Clientset: baseClient,
		core:      coreOverride,
	}

	streamer := NewStreamer(client, applog.Noop, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	target := containerTarget{
		namespace: "default",
		pod:       "done-pod",
		container: "app",
		state:     &containerState{},
	}

	entriesCh := make(chan Entry, 5)
	errCh := make(chan error, 1)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, containerlogs.LineFilter{}, entriesCh, errCh, nil)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("followContainer did not exit for terminated pod")
	}

	require.Len(t, podsOverride.sinceTimes, 1, "terminated pods should not reopen container logs streams")
	select {
	case entry := <-entriesCh:
		require.Equal(t, "final", entry.Line)
	default:
		t.Fatal("expected final log entry")
	}
}

func ensureTestPod(t *testing.T, client *fake.Clientset, namespace, name string, phase corev1.PodPhase) {
	t.Helper()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Status: corev1.PodStatus{
			Phase: phase,
		},
	}
	_, err := client.CoreV1().Pods(namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)
}

// buildContainerLogsStream constructs a mock container logs stream for the supplied messages.
func buildContainerLogsStream(origin time.Time, offsets []time.Duration, messages []string) string {
	var builder strings.Builder
	for i := range messages {
		ts := origin.Add(offsets[i]).Format(time.RFC3339Nano)
		builder.WriteString(fmt.Sprintf("%s %s\n", ts, messages[i]))
	}
	return builder.String()
}

type stubClient struct {
	*fake.Clientset
	core corev1client.CoreV1Interface
}

func (s *stubClient) CoreV1() corev1client.CoreV1Interface {
	return s.core
}

type logCore struct {
	corev1client.CoreV1Interface
	overrides map[string]*logPods
}

func (l *logCore) Pods(namespace string) corev1client.PodInterface {
	if override, ok := l.overrides[namespace]; ok {
		return override
	}
	return l.CoreV1Interface.Pods(namespace)
}

type logResponse struct {
	body    string
	status  int
	onClose func()
}

type logPods struct {
	corev1client.PodInterface
	namespace string

	mu         sync.Mutex
	streams    []logResponse
	sinceTimes []*metav1.Time
	containers []string
}

func newLogPods(delegate corev1client.PodInterface, namespace string, streams []string) *logPods {
	responses := make([]logResponse, len(streams))
	for i, s := range streams {
		responses[i] = logResponse{body: s, status: http.StatusOK}
	}
	return newLogPodsWithResponses(delegate, namespace, responses)
}

func newLogPodsWithResponses(delegate corev1client.PodInterface, namespace string, responses []logResponse) *logPods {
	return &logPods{
		PodInterface: delegate,
		namespace:    namespace,
		streams:      append([]logResponse(nil), responses...),
	}
}

func (p *logPods) GetLogs(name string, opts *corev1.PodLogOptions) *restclient.Request {
	p.mu.Lock()
	defer p.mu.Unlock()

	if opts != nil && opts.SinceTime != nil {
		copy := opts.SinceTime.DeepCopy()
		p.sinceTimes = append(p.sinceTimes, copy)
	} else {
		p.sinceTimes = append(p.sinceTimes, nil)
	}
	if opts != nil {
		p.containers = append(p.containers, opts.Container)
	}

	resp := logResponse{status: http.StatusOK}
	if len(p.streams) > 0 {
		resp = p.streams[0]
		p.streams = p.streams[1:]
	}

	status := resp.status
	if status == 0 {
		status = http.StatusOK
	}
	body := resp.body

	fakeClient := &fakerest.RESTClient{
		GroupVersion:         corev1.SchemeGroupVersion,
		NegotiatedSerializer: kubescheme.Codecs.WithoutConversion(),
		VersionedAPIPath:     "/api/v1",
		Client: fakerest.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: status,
				Body: &callbackReadCloser{
					Reader:  strings.NewReader(body),
					onClose: resp.onClose,
				},
			}, nil
		}),
	}

	req := fakeClient.Get().
		Resource("pods").
		Namespace(p.namespace).
		Name(name).
		SubResource("log")

	if opts != nil {
		req.VersionedParams(opts, kubescheme.ParameterCodec)
	}

	return req
}

func (p *logPods) containerRequestCount(container string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	count := 0
	for _, requested := range p.containers {
		if requested == container {
			count++
		}
	}
	return count
}

type callbackReadCloser struct {
	io.Reader
	onClose func()
}

func (c *callbackReadCloser) Close() error {
	if c.onClose != nil {
		c.onClose()
	}
	return nil
}
