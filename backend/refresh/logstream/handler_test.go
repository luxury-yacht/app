package logstream

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestParseOptions(t *testing.T) {
	tests := []struct {
		name        string
		query       url.Values
		expectError bool
		kind        string
		tail        int
	}{
		{
			name:  "valid scope with defaults",
			query: url.Values{"scope": []string{"default:pod:nginx"}},
			kind:  "pod",
			tail:  defaultTailLines,
		},
		{
			name:  "custom tail",
			query: url.Values{"scope": []string{"prod:deployment:web"}, "tailLines": []string{"200"}},
			kind:  "deployment",
			tail:  200,
		},
		{
			name:        "missing scope",
			query:       url.Values{},
			expectError: true,
		},
		{
			name:        "empty namespace",
			query:       url.Values{"scope": []string{":pod:nginx"}},
			expectError: true,
		},
		{
			name:        "empty kind",
			query:       url.Values{"scope": []string{"default::nginx"}},
			expectError: true,
		},
		{
			name:        "empty name",
			query:       url.Values{"scope": []string{"default:pod:"}},
			expectError: true,
		},
	}

	for _, tt := range tests {
		request := httptest.NewRequest("GET", "/?"+tt.query.Encode(), nil)
		opts, err := parseOptions(request)
		if tt.expectError {
			if err == nil {
				t.Fatalf("%s: expected error", tt.name)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", tt.name, err)
		}
		if opts.Kind != tt.kind {
			t.Fatalf("%s: expected kind %q, got %q", tt.name, tt.kind, opts.Kind)
		}
		if opts.TailLines != tt.tail {
			t.Fatalf("%s: expected tail %d, got %d", tt.name, tt.tail, opts.TailLines)
		}
	}
}

func TestMatchContainerFilter(t *testing.T) {
	if !matchContainerFilter("nginx", "nginx", false) {
		t.Fatal("expected direct match for regular container")
	}
	if matchContainerFilter("init-setup", "init-setup", false) == false {
		t.Fatalf("expected filter to match identical name")
	}
	if !matchContainerFilter("init-setup", "init-setup (init)", true) {
		t.Fatal("expected init suffix match")
	}
	if matchContainerFilter("nginx", "sidecar", false) {
		t.Fatal("unexpected match for different container")
	}
}

func TestServeHTTPRequiresFlusher(t *testing.T) {
	client := fake.NewClientset()
	handler, err := NewHandler(client, noopLogger{}, telemetry.NewRecorder())
	if err != nil {
		t.Fatalf("NewHandler returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/?scope=default:pod:web", nil)

	rec := &noFlushRecorder{
		header: make(http.Header),
	}

	handler.ServeHTTP(rec, req)

	if rec.status != http.StatusInternalServerError {
		t.Fatalf("expected 500 when flusher missing, got %d", rec.status)
	}
	if body := rec.body.String(); body != "streaming not supported\n" {
		t.Fatalf("unexpected body %q", body)
	}
}

func TestServeHTTPEmitsInitialSnapshot(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "my-pod",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app"}},
		},
	}
	client := fake.NewClientset(pod)
	handler, err := NewHandler(client, noopLogger{}, telemetry.NewRecorder())
	if err != nil {
		t.Fatalf("NewHandler returned error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest("GET", "/?scope=default:pod:my-pod", nil).WithContext(ctx)
	rec := newFlushRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(rec, req)
		close(done)
	}()

	var payload EventPayload
	require.Eventually(t, func() bool {
		raw := rec.Body()
		idx := strings.Index(raw, "data: ")
		if idx == -1 {
			return false
		}
		start := idx + len("data: ")
		rest := raw[start:]
		end := strings.IndexByte(rest, '\n')
		if end == -1 {
			return false
		}
		jsonStr := rest[:end]
		if err := json.Unmarshal([]byte(jsonStr), &payload); err != nil {
			return false
		}
		return len(payload.Entries) > 0
	}, time.Second, 10*time.Millisecond, "expected initial log snapshot")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("log handler did not exit after cancel")
	}

	require.True(t, payload.Reset)
	require.Equal(t, "default:pod:my-pod", payload.Scope)
	require.Len(t, payload.Entries, 1)

	entry := payload.Entries[0]
	require.NotEmpty(t, entry.Line)
	require.Equal(t, "my-pod", entry.Pod)
	require.Equal(t, "app", entry.Container)
	require.False(t, entry.IsInit)
	require.Equal(t, http.StatusOK, rec.Status())
}

func TestServeHTTPEmitsPermissionDeniedPayload(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "", Resource: "pods"},
			"",
			errors.New("forbidden"),
		)
	})

	handler, err := NewHandler(client, noopLogger{}, telemetry.NewRecorder())
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/?scope=default:job:my-job", nil)
	rec := newFlushRecorder()

	handler.ServeHTTP(rec, req)

	events := parseSSEEvents(rec.Body())
	require.Len(t, events, 1)
	require.NotEmpty(t, events[0].Error)
	require.NotNil(t, events[0].ErrorDetails)
	require.Equal(t, "object-logs", events[0].ErrorDetails.Details.Domain)
	require.Equal(t, logPermissionResource, events[0].ErrorDetails.Details.Resource)
}

func TestServeHTTPStreamsUpdates(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "stream-pod",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app"}},
		},
	}
	baseClient := fake.NewClientset(pod)
	origin := time.Unix(0, 0)
	streams := []string{
		buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"initial"}),
		buildLogStream(origin, []time.Duration{2 * time.Millisecond}, []string{"update"}),
	}

	delegateCore := baseClient.CoreV1()
	override := newLogPods(delegateCore.Pods("default"), "default", streams)
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{
			CoreV1Interface: delegateCore,
			overrides:       map[string]*logPods{"default": override},
		},
	}

	handler, err := NewHandler(client, noopLogger{}, telemetry.NewRecorder())
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest("GET", "/?scope=default:pod:stream-pod", nil).WithContext(ctx)
	rec := newFlushRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(rec, req)
		close(done)
	}()

	var events []EventPayload
	require.Eventually(t, func() bool {
		events = parseSSEEvents(rec.Body())
		return len(events) >= 2
	}, 4*time.Second, 20*time.Millisecond, "expected at least two SSE events")

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("ServeHTTP did not exit after cancellation")
	}

	first := events[0]
	require.True(t, first.Reset)
	require.Len(t, first.Entries, 1)
	require.Equal(t, "initial", first.Entries[0].Line)

	second := events[1]
	require.False(t, second.Reset)
	require.Len(t, second.Entries, 1)
	require.Equal(t, "update", second.Entries[0].Line)
}

func TestServeHTTPEmitsErrorEvent(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "default",
			Name:      "error-pod",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app"}},
		},
	}
	baseClient := fake.NewClientset(pod)
	origin := time.Unix(0, 0)
	responses := []logResponse{
		{body: buildLogStream(origin, []time.Duration{time.Millisecond}, []string{"initial"}), status: http.StatusOK},
		{body: "boom", status: http.StatusInternalServerError},
	}

	delegateCore := baseClient.CoreV1()
	override := newLogPodsWithResponses(delegateCore.Pods("default"), "default", responses)
	client := &stubClient{
		Clientset: baseClient,
		core: &logCore{
			CoreV1Interface: delegateCore,
			overrides:       map[string]*logPods{"default": override},
		},
	}

	handler, err := NewHandler(client, noopLogger{}, telemetry.NewRecorder())
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest("GET", "/?scope=default:pod:error-pod", nil).WithContext(ctx)
	rec := newFlushRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(rec, req)
		close(done)
	}()

	var events []EventPayload
	require.Eventually(t, func() bool {
		events = parseSSEEvents(rec.Body())
		if len(events) < 2 {
			return false
		}
		for _, evt := range events {
			if evt.Error != "" {
				return true
			}
		}
		return false
	}, 5*time.Second, 20*time.Millisecond, "expected error SSE event")

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("ServeHTTP did not exit after cancellation")
	}

	var errorEvent *EventPayload
	for i := range events {
		if events[i].Error != "" {
			errorEvent = &events[i]
			break
		}
	}
	require.NotNil(t, errorEvent, "error event should be present")
	require.Contains(t, errorEvent.Error, "logstream: follow failed")
	require.Empty(t, errorEvent.Entries)
}

func TestSplitTimestamp(t *testing.T) {
	ts, line := splitTimestamp("2024-01-02T15:04:05Z some message")
	if ts == "" || line != "some message" {
		t.Fatalf("expected timestamp split, got %q / %q", ts, line)
	}
	ts, line = splitTimestamp("no-space-line")
	if ts != "" || line != "no-space-line" {
		t.Fatalf("expected entire line without timestamp, got %q / %q", ts, line)
	}
}

type noFlushRecorder struct {
	header http.Header
	body   strings.Builder
	status int
}

func (n *noFlushRecorder) Header() http.Header {
	return n.header
}

func (n *noFlushRecorder) Write(b []byte) (int, error) {
	return n.body.WriteString(string(b))
}

func (n *noFlushRecorder) WriteHeader(statusCode int) {
	n.status = statusCode
}

type flushRecorder struct {
	header http.Header
	body   strings.Builder
	status int
	mu     sync.Mutex
}

func newFlushRecorder() *flushRecorder {
	return &flushRecorder{
		header: make(http.Header),
	}
}

func (f *flushRecorder) Header() http.Header {
	return f.header
}

func (f *flushRecorder) Write(b []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.body.WriteString(string(b))
}

func (f *flushRecorder) WriteHeader(statusCode int) {
	f.status = statusCode
}

func (f *flushRecorder) Flush() {}

func (f *flushRecorder) Body() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.body.String()
}

func (f *flushRecorder) Status() int {
	if f.status == 0 {
		return http.StatusOK
	}
	return f.status
}

func parseSSEEvents(raw string) []EventPayload {
	chunks := strings.Split(raw, "\n\n")
	events := make([]EventPayload, 0, len(chunks))
	for _, chunk := range chunks {
		if !strings.HasPrefix(chunk, "event: log") {
			continue
		}
		idx := strings.Index(chunk, "data: ")
		if idx == -1 {
			continue
		}
		data := chunk[idx+len("data: "):]
		if nl := strings.IndexByte(data, '\n'); nl != -1 {
			data = data[:nl]
		}
		var payload EventPayload
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			continue
		}
		events = append(events, payload)
	}
	return events
}
