package logstream

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

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
		buildLogStream(origin, []time.Duration{time.Millisecond, 2 * time.Millisecond}, []string{"first", "second"}),
		buildLogStream(origin, []time.Duration{2 * time.Millisecond, 3 * time.Millisecond}, []string{"second", "third"}),
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

	streamer := NewStreamer(client, stubLogger{}, nil)

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
		streamer.followContainer(ctx, target, entriesCh, errCh, dropCh)
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
		buildLogStream(time.Unix(0, 0), []time.Duration{time.Millisecond}, []string{"first"}),
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
	streamer := NewStreamer(client, stubLogger{}, recorder)

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
		streamer.followContainer(ctx, target, entriesCh, errCh, nil)
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
	require.Equal(t, telemetry.StreamLogs, status.Name)
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
		{status: http.StatusOK, body: buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"line"})},
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

	streamer := NewStreamer(client, stubLogger{}, nil)

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
		streamer.followContainer(ctx, target, entriesCh, errCh, dropCh)
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

func TestFollowContainerStopsAfterInitCompletes(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "my-pod", corev1.PodRunning)

	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	streams := []string{
		buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"init-line"}),
		buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"duplicate"}),
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

	streamer := NewStreamer(client, stubLogger{}, nil)

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
		streamer.followContainer(ctx, target, entriesCh, errCh, nil)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("followContainer did not exit for init container")
	}

	require.Len(t, podsOverride.sinceTimes, 1, "init containers should not reopen log streams")
	select {
	case entry := <-entriesCh:
		require.Equal(t, "init-line", entry.Line)
	default:
		t.Fatal("expected init log entry")
	}
}

func TestFollowContainerStopsWhenPodTerminated(t *testing.T) {
	baseClient := fake.NewClientset()
	ensureTestPod(t, baseClient, "default", "done-pod", corev1.PodSucceeded)

	delegateCore := baseClient.CoreV1()
	origin := time.Unix(0, 0)
	streams := []string{
		buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"final"}),
		buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"duplicate"}),
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

	streamer := NewStreamer(client, stubLogger{}, nil)

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
		streamer.followContainer(ctx, target, entriesCh, errCh, nil)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("followContainer did not exit for terminated pod")
	}

	require.Len(t, podsOverride.sinceTimes, 1, "terminated pods should not reopen log streams")
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

// buildLogStream constructs a mock log stream for the supplied messages.
func buildLogStream(origin time.Time, offsets []time.Duration, messages []string) string {
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
	body   string
	status int
}

type logPods struct {
	corev1client.PodInterface
	namespace string

	mu         sync.Mutex
	streams    []logResponse
	sinceTimes []*metav1.Time
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
				Body:       io.NopCloser(strings.NewReader(body)),
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
