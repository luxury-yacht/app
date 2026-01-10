package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

type flushRecorder struct {
	*httptest.ResponseRecorder
}

func newFlushRecorder() *flushRecorder {
	return &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (f *flushRecorder) Flush() {}

type stubEventManager struct {
	mu    sync.Mutex
	scope string
	ch    chan eventstream.StreamEvent
}

func (m *stubEventManager) Subscribe(scope string) (<-chan eventstream.StreamEvent, context.CancelFunc) {
	m.mu.Lock()
	m.scope = scope
	m.mu.Unlock()
	return m.ch, func() {
		close(m.ch)
	}
}

func TestAggregateEventStreamHandlerStreamsAcrossClusters(t *testing.T) {
	service := stubSnapshotService{
		build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{
				Domain: domain,
				Payload: snapshot.ClusterEventsSnapshot{
					Events: []snapshot.ClusterEventEntry{{
						ClusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
						Message:     "initial message",
					}},
				},
			}, nil
		},
	}

	managerA := &stubEventManager{ch: make(chan eventstream.StreamEvent, 1)}
	managerB := &stubEventManager{ch: make(chan eventstream.StreamEvent, 1)}
	handlers := map[string]eventStreamSubscriber{
		"cluster-a": managerA,
		"cluster-b": managerB,
	}
	meta := map[string]snapshot.ClusterMeta{
		"cluster-a": {ClusterID: "cluster-a", ClusterName: "alpha"},
		"cluster-b": {ClusterID: "cluster-b", ClusterName: "bravo"},
	}
	handler := newAggregateEventStreamHandler(
		service,
		handlers,
		meta,
		[]string{"cluster-a", "cluster-b"},
		nil,
		noopLogger{},
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/events?scope=clusters=cluster-a,cluster-b|cluster", nil).WithContext(ctx)
	rec := newFlushRecorder()

	go handler.ServeHTTP(rec, req)

	require.Eventually(t, func() bool {
		return strings.Contains(rec.Body.String(), "initial message")
	}, time.Second, 10*time.Millisecond)

	managerA.mu.Lock()
	require.Equal(t, "cluster", managerA.scope)
	managerA.mu.Unlock()

	managerB.mu.Lock()
	require.Equal(t, "cluster", managerB.scope)
	managerB.mu.Unlock()

	managerA.ch <- eventstream.StreamEvent{Entry: eventstream.Entry{Message: "event-a"}, Sequence: 2}
	managerB.ch <- eventstream.StreamEvent{Entry: eventstream.Entry{Message: "event-b"}, Sequence: 3}

	require.Eventually(t, func() bool {
		body := rec.Body.String()
		return strings.Contains(body, "event-a") &&
			strings.Contains(body, "event-b") &&
			strings.Contains(body, `"clusterId":"cluster-a"`) &&
			strings.Contains(body, `"clusterId":"cluster-b"`)
	}, time.Second, 10*time.Millisecond)
}

func TestAggregateEventStreamResumesFromBuffer(t *testing.T) {
	buildCalls := 0
	service := stubSnapshotService{
		build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
			buildCalls++
			return &refresh.Snapshot{
				Domain: domain,
				Payload: snapshot.ClusterEventsSnapshot{
					Events: []snapshot.ClusterEventEntry{{
						ClusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
						Message:     "snapshot message",
					}},
				},
			}, nil
		},
	}

	managerA := &stubEventManager{ch: make(chan eventstream.StreamEvent, 1)}
	handlers := map[string]eventStreamSubscriber{
		"cluster-a": managerA,
	}
	meta := map[string]snapshot.ClusterMeta{
		"cluster-a": {ClusterID: "cluster-a", ClusterName: "alpha"},
	}
	handler := newAggregateEventStreamHandler(
		service,
		handlers,
		meta,
		[]string{"cluster-a"},
		nil,
		noopLogger{},
	)

	scopeKey := "clusters=cluster-a|cluster"
	handler.buffers[scopeKey] = newAggregateEventBuffer(config.AggregateEventStreamResumeBufferSize)
	handler.buffers[scopeKey].add(aggregateBufferItem{Sequence: 1, Entry: eventstream.Entry{Message: "older"}})
	handler.buffers[scopeKey].add(aggregateBufferItem{Sequence: 2, Entry: eventstream.Entry{Message: "buffered"}})
	handler.sequences[scopeKey] = 2

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/events?scope=clusters=cluster-a|cluster&since=1", nil).WithContext(ctx)
	rec := newFlushRecorder()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		handler.ServeHTTP(rec, req)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(rec.Body.String(), "buffered")
	}, time.Second, 10*time.Millisecond)
	require.Equal(t, 0, buildCalls)

	cancel()
	wg.Wait()
}

func TestAggregateEventStreamFallsBackToSnapshotWhenResumeTooOld(t *testing.T) {
	buildCalls := 0
	service := stubSnapshotService{
		build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
			buildCalls++
			return &refresh.Snapshot{
				Domain: domain,
				Payload: snapshot.ClusterEventsSnapshot{
					Events: []snapshot.ClusterEventEntry{{
						ClusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
						Message:     "snapshot fallback",
					}},
				},
			}, nil
		},
	}

	managerA := &stubEventManager{ch: make(chan eventstream.StreamEvent, 1)}
	handlers := map[string]eventStreamSubscriber{
		"cluster-a": managerA,
	}
	meta := map[string]snapshot.ClusterMeta{
		"cluster-a": {ClusterID: "cluster-a", ClusterName: "alpha"},
	}
	handler := newAggregateEventStreamHandler(
		service,
		handlers,
		meta,
		[]string{"cluster-a"},
		nil,
		noopLogger{},
	)

	scopeKey := "clusters=cluster-a|cluster"
	handler.buffers[scopeKey] = newAggregateEventBuffer(1)
	handler.buffers[scopeKey].add(aggregateBufferItem{Sequence: 5, Entry: eventstream.Entry{Message: "buffered"}})
	handler.sequences[scopeKey] = 5

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/events?scope=clusters=cluster-a|cluster&since=1", nil).WithContext(ctx)
	rec := newFlushRecorder()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		handler.ServeHTTP(rec, req)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(rec.Body.String(), "snapshot fallback")
	}, time.Second, 10*time.Millisecond)
	require.Equal(t, 1, buildCalls)

	cancel()
	wg.Wait()
}

func TestApplyEventCORSAcceptsOptionsRequests(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/v2/stream/events", nil)
	rec := httptest.NewRecorder()

	ok := applyEventCORS(rec, req)
	require.False(t, ok)
	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
}

func TestApplyEventCORSAllowsGetRequests(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/events", nil)
	rec := httptest.NewRecorder()

	ok := applyEventCORS(rec, req)
	require.True(t, ok)
	require.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
}

func TestWriteEventPayloadEmitsSSE(t *testing.T) {
	rec := newFlushRecorder()
	payload := eventstream.Payload{
		Domain:   "events",
		Scope:    "cluster",
		Sequence: 5,
	}

	err := writeEventPayload(rec, rec, payload)
	require.NoError(t, err)
	require.Contains(t, rec.Body.String(), "event: event")
	require.Contains(t, rec.Body.String(), "id: 5")
	require.Contains(t, rec.Body.String(), "\"sequence\":5")
}

func TestNoopLoggerDoesNothing(t *testing.T) {
	logger := noopLogger{}
	logger.Debug("debug")
	logger.Info("info")
	logger.Warn("warn")
	logger.Error("error")
}
