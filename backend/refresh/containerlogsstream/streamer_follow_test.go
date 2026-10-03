package containerlogsstream

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
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
)

func TestFollowContainerStreamsBatches(t *testing.T) {
	baseClient := fake.NewClientset()

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
	}

	entriesCh := make(chan Entry, 10)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, channelSink(entriesCh), followOptions{running: whileRunning})
		close(done)
	}()

	var entries []Entry
	timeout := time.After(4 * time.Second)
	for len(entries) < 3 {
		select {
		case entry := <-entriesCh:
			entries = append(entries, entry)
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

func TestFollowContainerRetriesAfterStreamFailure(t *testing.T) {
	baseClient := fake.NewClientset()
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
	}

	entriesCh := make(chan Entry, 1)
	issues := newIssueSet()
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, channelSink(entriesCh), followOptions{running: whileRunning, issues: issues})
		close(done)
	}()

	select {
	case <-issues.notify:
		require.Len(t, issues.list(), 1, "the failed open is listed as an issue")
	case <-time.After(time.Second):
		t.Fatal("expected the failed open to be reported")
	}

	select {
	case entry := <-entriesCh:
		require.Equal(t, "line", entry.Line)
	case <-time.After(3 * time.Second):
		t.Fatal("expected log entry after retry")
	}
	require.Empty(t, issues.list(), "the issue clears once the stream opens")

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
	issues := newIssueSet()
	done := make(chan struct{})
	go func() {
		streamer.followContainer(
			context.Background(),
			containerTarget{namespace: "default", pod: "gone", container: "app"},
			channelSink(make(chan Entry, 1)),
			followOptions{issues: issues},
		)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("NotFound should stop the follower without reconnect backoff")
	}
	require.Empty(t, issues.list(), "a pod that is gone is not an issue")
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
		channelSink(make(chan Entry)),
		followOptions{},
	)
	require.Zero(t, podsOverride.containerRequestCount("app"))
}

func TestFollowContainerClosesCompletedStreamExactlyOnce(t *testing.T) {
	baseClient := fake.NewClientset()
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
		channelSink(entries),
		followOptions{},
	)
	require.Equal(t, 1, closeCalls)
	require.Equal(t, "final", (<-entries).Line)
}

// TestFollowContainerDeduplicatesMultipleLinesAtSameTimestamp verifies that when multiple
// different log lines share the same timestamp, they are not duplicated on stream reconnection.
// This tests a bug where Java applications emit multiple lines at the same millisecond timestamp,
// and on reconnection (using SinceTime), all lines at that timestamp are returned again.
func TestFollowContainerDeduplicatesMultipleLinesAtSameTimestamp(t *testing.T) {
	baseClient := fake.NewClientset()

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
	}

	entriesCh := make(chan Entry, 20)
	done := make(chan struct{})

	go func() {
		streamer.followContainer(ctx, target, channelSink(entriesCh), followOptions{running: whileRunning})
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

// A stream usually ends just before the watch reports its container stopped;
// the follower checks again after the backoff and does not reopen.
func TestFollowContainerStopsOnceTheContainerIsNoLongerRunning(t *testing.T) {
	baseClient := fake.NewClientset()
	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	podsOverride := newLogPods(delegateCore.Pods("default"), "default", []string{
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"final"}),
		buildContainerLogsStream(origin, []time.Duration{time.Millisecond, 2 * time.Millisecond}, []string{"final", "duplicate"}),
	})
	client := &stubClient{Clientset: baseClient, core: &logCore{
		CoreV1Interface: delegateCore, overrides: map[string]*logPods{"default": podsOverride},
	}}
	var stopped atomic.Bool
	entriesCh := make(chan Entry, 5)
	done := make(chan struct{})
	go func() {
		defer close(done)
		NewStreamer(client, applog.Noop, nil).followContainer(context.Background(),
			containerTarget{namespace: "default", pod: "done-pod", container: "app"}, channelSink(entriesCh),
			followOptions{running: func() bool { return !stopped.Load() }})
	}()
	require.Equal(t, "final", (<-entriesCh).Line)
	// The watch reports the container terminated during the retry backoff.
	stopped.Store(true)

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("followContainer kept following a stopped container")
	}
	require.Equal(t, 1, podsOverride.requestCount("app"))
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
	// holdOpen keeps the stream open after body until it is closed, like a
	// follow request on a quiet container.
	holdOpen bool
	// hang never returns response headers until the request is cancelled, like
	// a request to an unreachable kubelet.
	hang bool
	// reader, when set, supplies the body so a test can write lines over time.
	reader io.Reader
}

type logPods struct {
	corev1client.PodInterface
	namespace string

	mu         sync.Mutex
	streams    []logResponse
	sinceTimes []*metav1.Time
	tailLines  []*int64
	follows    []bool
	containers []string
	// responder, when set, scripts the response per request instead of streams.
	responder func(*corev1.PodLogOptions) logResponse
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
		p.tailLines = append(p.tailLines, opts.TailLines)
		p.follows = append(p.follows, opts.Follow)
	}

	resp := logResponse{status: http.StatusOK}
	switch {
	case p.responder != nil:
		resp = p.responder(opts)
	case len(p.streams) > 0:
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
		Client: fakerest.CreateHTTPClient(func(request *http.Request) (*http.Response, error) {
			if resp.hang {
				<-request.Context().Done()
				return nil, request.Context().Err()
			}
			var reader io.Reader = strings.NewReader(body)
			if resp.reader != nil {
				reader = resp.reader
			}
			onClose := resp.onClose
			// Only a follow request stays open; a plain read always ends.
			if resp.holdOpen && (opts == nil || opts.Follow) {
				open := &openReader{closed: make(chan struct{}), request: request.Context()}
				reader = io.MultiReader(reader, open)
				previous := onClose
				onClose = func() {
					open.close()
					if previous != nil {
						previous()
					}
				}
			}
			return &http.Response{
				StatusCode: status,
				Body:       &callbackReadCloser{Reader: reader, onClose: onClose},
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

// A line longer than the reader's limit used to stop the follower at that point
// forever: every reconnect re-read the same line and failed again.
func TestFollowContainerDeliversLinesAfterAnOversizedLine(t *testing.T) {
	baseClient := fake.NewClientset()
	delegateCore := baseClient.CoreV1()
	origin := time.Unix(1000, 0)
	huge := strings.Repeat("x", 2*1024*1024)
	body := buildContainerLogsStream(origin,
		[]time.Duration{time.Millisecond, 2 * time.Millisecond, 3 * time.Millisecond},
		[]string{"before", huge, "after"})
	podsOverride := newLogPods(delegateCore.Pods("default"), "default", []string{body})
	client := &stubClient{Clientset: baseClient, core: &logCore{
		CoreV1Interface: delegateCore, overrides: map[string]*logPods{"default": podsOverride},
	}}
	streamer := NewStreamer(client, applog.Noop, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entriesCh := make(chan Entry, 8)
	go streamer.followContainer(ctx, containerTarget{namespace: "default", pod: "big-pod", container: "app"}, channelSink(entriesCh), followOptions{})

	var lines []string
	for len(lines) < 3 {
		select {
		case entry := <-entriesCh:
			lines = append(lines, entry.Line)
		case <-time.After(2 * time.Second):
			t.Fatalf("follower stalled after %d lines", len(lines))
		}
	}
	require.Equal(t, "before", lines[0])
	// The limit applies to the raw kubelet line, timestamp prefix included.
	require.Contains(t, lines[1], " … [truncated ")
	require.LessOrEqual(t, len(lines[1]), containerlogs.MaxLineBytes+len(" … [truncated 2097152 bytes]"))
	require.Equal(t, "after", lines[2])
}

// openReader blocks reads until closed, then reports the end of the stream.
// Like a real response body, it fails once its request is cancelled.
type openReader struct {
	closed  chan struct{}
	once    sync.Once
	request context.Context
}

func (r *openReader) Read([]byte) (int, error) {
	select {
	case <-r.closed:
		return 0, io.EOF
	case <-r.request.Done():
		return 0, r.request.Err()
	}
}

func (r *openReader) close() { r.once.Do(func() { close(r.closed) }) }

// followLines runs one follower against scripted log responses and returns the
// lines it delivers until want lines arrive and a short quiet period passes.
func followLines(t *testing.T, responses []logResponse, want int) ([]string, *logPods) {
	t.Helper()
	baseClient := fake.NewClientset()
	delegateCore := baseClient.CoreV1()
	podsOverride := newLogPodsWithResponses(delegateCore.Pods("default"), "default", responses)
	client := &stubClient{Clientset: baseClient, core: &logCore{
		CoreV1Interface: delegateCore, overrides: map[string]*logPods{"default": podsOverride},
	}}
	streamer := NewStreamer(client, applog.Noop, nil)
	ctx, cancel := context.WithCancel(context.Background())
	entriesCh := make(chan Entry, 64)
	done := make(chan struct{})
	go func() {
		defer close(done)
		streamer.followContainer(ctx, containerTarget{namespace: "default", pod: "demo", container: "app"}, channelSink(entriesCh), followOptions{running: whileRunning})
	}()
	var lines []string
	deadline := time.After(5 * time.Second)
	quiet := time.After(time.Hour)
	for {
		select {
		case entry := <-entriesCh:
			lines = append(lines, entry.Line)
			if len(lines) >= want {
				quiet = time.After(300 * time.Millisecond)
			}
		case <-quiet:
			stopFollower(t, cancel, done)
			return lines, podsOverride
		case <-deadline:
			stopFollower(t, cancel, done)
			t.Fatalf("timed out with %d of %d lines: %v", len(lines), want, lines)
		}
	}
}

// stopFollower cancels a follower and fails the test if it does not stop, even
// while blocked reading a quiet stream.
func stopFollower(t *testing.T, cancel context.CancelFunc, done <-chan struct{}) {
	t.Helper()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("follower did not stop after cancellation")
	}
}

func TestFollowContainerDeliversIdenticalLinesAtOneTimestamp(t *testing.T) {
	origin := time.Unix(1000, 0)
	lines, _ := followLines(t, []logResponse{{
		body:     buildContainerLogsStream(origin, []time.Duration{time.Millisecond, time.Millisecond}, []string{"ping", "ping"}),
		holdOpen: true,
	}}, 2)
	require.Equal(t, []string{"ping", "ping"}, lines)
}

// A tail read can end inside a same-timestamp group. The reconnect replays the
// whole group; only the lines not yet delivered may come through.
func TestFollowContainerRecoversAnInterruptedTailAfterReconnect(t *testing.T) {
	origin := time.Unix(1000, 0)
	group := []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond}
	lines, pods := followLines(t, []logResponse{
		{body: buildContainerLogsStream(origin, group[:1], []string{"C"})},
		{body: buildContainerLogsStream(origin, group, []string{"A", "B", "C", "D"}), holdOpen: true},
	}, 2)
	require.Equal(t, []string{"C", "D"}, lines)

	pods.mu.Lock()
	defer pods.mu.Unlock()
	require.GreaterOrEqual(t, len(pods.sinceTimes), 2)
	require.NotNil(t, pods.sinceTimes[1], "the reconnect resumes from the delivered position")
}

// A stream that breaks mid-line delivers none of that line; the resumed stream
// delivers it whole, and each line once.
func TestFollowContainerDeliversALineCutOffByADroppedConnectionOnce(t *testing.T) {
	origin := time.Unix(1000, 0)
	group := []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, 2 * time.Millisecond}
	full := buildContainerLogsStream(origin, group, []string{"a", "b", "hello world", "next"})
	cut := full[:strings.Index(full, "hello world")+len("hello wo")]
	lines, _ := followLines(t, []logResponse{
		{reader: io.MultiReader(strings.NewReader(cut), brokenConnection{})},
		{body: full, holdOpen: true},
	}, 4)
	require.Equal(t, []string{"a", "b", "hello world", "next"}, lines)
}

// brokenConnection fails every read, like a reset connection.
type brokenConnection struct{}

func (brokenConnection) Read([]byte) (int, error) { return 0, errors.New("connection reset by peer") }

// Unmatched replay lines must not be held while an open stream stays quiet.
func TestFollowContainerReleasesUnmatchedReplayOnAQuietStream(t *testing.T) {
	origin := time.Unix(1000, 0)
	group := []time.Duration{time.Millisecond, time.Millisecond}
	lines, _ := followLines(t, []logResponse{
		{body: buildContainerLogsStream(origin, group, []string{"B", "C"})},
		{body: buildContainerLogsStream(origin, group, []string{"X", "Y"}), holdOpen: true},
	}, 4)
	require.Equal(t, []string{"B", "C", "X", "Y"}, lines)
}

func (p *logPods) requestCount(container string) int {
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

// channelSink hands a follower's entries to a test channel.
type channelSink chan Entry

func (c channelSink) add(entry Entry) { c <- entry }

// whileRunning reports the followed container as running, so the follower
// reopens an ended or failed stream.
func whileRunning() bool { return true }

// A follower without a resume point reads a bounded history, so a target
// admitted late never replays a container's whole log file.
func TestFollowContainerFirstOpenCarriesTailLines(t *testing.T) {
	baseClient := fake.NewClientset()
	pods := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", []logResponse{{holdOpen: true}})
	client := &stubClient{Clientset: baseClient, core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": pods}}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		NewStreamer(client, applog.Noop, nil).followContainer(ctx, containerTarget{namespace: "default", pod: "demo", container: "app"}, testPending(), followOptions{tailLines: 500})
	}()
	require.Eventually(t, func() bool { return pods.requestCount("app") == 1 }, time.Second, 5*time.Millisecond)
	stopFollower(t, cancel, done)

	pods.mu.Lock()
	defer pods.mu.Unlock()
	require.NotNil(t, pods.tailLines[0])
	require.EqualValues(t, 500, *pods.tailLines[0])
	require.Nil(t, pods.sinceTimes[0])
}

// A resume reads no more history than a first open: the client cannot hold
// more of one container's lines than its buffer size, and a replay after a long
// gap must not read everything written since.
func TestFollowContainerResumeCarriesTheTailBound(t *testing.T) {
	baseClient := fake.NewClientset()
	pods := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", []logResponse{{holdOpen: true}})
	client := &stubClient{Clientset: baseClient, core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": pods}}}
	var cursor containerlogs.ResumeCursor
	cursor.Observe(time.Unix(1000, 0), "delivered")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		NewStreamer(client, applog.Noop, nil).followContainer(ctx, containerTarget{namespace: "default", pod: "demo", container: "app", cursor: cursor}, testPending(), followOptions{tailLines: 500})
	}()
	require.Eventually(t, func() bool { return pods.requestCount("app") == 1 }, time.Second, 5*time.Millisecond)
	stopFollower(t, cancel, done)

	pods.mu.Lock()
	defer pods.mu.Unlock()
	require.NotNil(t, pods.sinceTimes[0])
	require.NotNil(t, pods.tailLines[0])
	require.EqualValues(t, 500, *pods.tailLines[0])
}

// A request that never returns response headers is abandoned after the
// response timeout and retried.
func TestFollowContainerRetriesARequestThatNeverResponds(t *testing.T) {
	origin := time.Unix(1000, 0)
	baseClient := fake.NewClientset()
	pods := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", []logResponse{
		{hang: true},
		{body: buildContainerLogsStream(origin, []time.Duration{time.Millisecond}, []string{"answered"}), holdOpen: true},
	})
	client := &stubClient{Clientset: baseClient, core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": pods}}}
	streamer := NewStreamer(client, applog.Noop, nil)
	streamer.responseTimeout = 50 * time.Millisecond
	entries := make(chan Entry, 4)
	issues := newIssueSet()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		streamer.followContainer(ctx, containerTarget{namespace: "default", pod: "demo", container: "app"}, channelSink(entries), followOptions{running: whileRunning, issues: issues})
	}()

	select {
	case <-issues.notify:
		listed := issues.list()
		require.Len(t, listed, 1)
		require.Equal(t, containerlogs.IssueFailed, listed[0].State)
		require.Contains(t, listed[0].Reason, "no response within")
	case <-time.After(2 * time.Second):
		t.Fatal("the unanswered request was not reported")
	}
	select {
	case entry := <-entries:
		require.Equal(t, "answered", entry.Line)
	case <-time.After(4 * time.Second):
		t.Fatal("the hanging request was not retried")
	}
	stopFollower(t, cancel, done)
	require.Equal(t, 2, pods.requestCount("app"))
}

// Once a stream is established, silence is normal: it never times out.
func TestFollowContainerKeepsAQuietEstablishedStreamOpen(t *testing.T) {
	var closed atomic.Bool
	baseClient := fake.NewClientset()
	pods := newLogPodsWithResponses(baseClient.CoreV1().Pods("default"), "default", []logResponse{{holdOpen: true, onClose: func() { closed.Store(true) }}})
	client := &stubClient{Clientset: baseClient, core: &logCore{CoreV1Interface: baseClient.CoreV1(), overrides: map[string]*logPods{"default": pods}}}
	streamer := NewStreamer(client, applog.Noop, nil)
	streamer.responseTimeout = 20 * time.Millisecond
	issues := newIssueSet()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		streamer.followContainer(ctx, containerTarget{namespace: "default", pod: "demo", container: "app"}, testPending(), followOptions{running: whileRunning, issues: issues})
	}()

	time.Sleep(200 * time.Millisecond)
	require.False(t, closed.Load(), "the response timeout cut the quiet stream")
	stopFollower(t, cancel, done)
	require.Equal(t, 1, pods.requestCount("app"))
	require.Empty(t, issues.list())
}
