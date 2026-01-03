package eventstream

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

type flushRecorder struct {
	*httptest.ResponseRecorder
}

func newFlushRecorder() *flushRecorder {
	return &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (f *flushRecorder) Flush() {}

func TestHandlerRejectsNonGET(t *testing.T) {
	handler, _, _ := newTestHandler(t, func(scope string) (*refresh.Snapshot, error) {
		return &refresh.Snapshot{Domain: "cluster-events", Payload: snapshot.ClusterEventsSnapshot{}}, nil
	})

	req := httptest.NewRequest(http.MethodPost, "/stream", nil)
	rec := newFlushRecorder()

	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}

func TestHandlerRejectsInvalidScope(t *testing.T) {
	handler, _, _ := newTestHandler(t, func(scope string) (*refresh.Snapshot, error) {
		return &refresh.Snapshot{Domain: "cluster-events", Payload: snapshot.ClusterEventsSnapshot{}}, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/stream?scope=invalid", nil)
	rec := newFlushRecorder()

	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandlerInitialSnapshotFailure(t *testing.T) {
	handler, manager, recorder := newTestHandler(t, func(scope string) (*refresh.Snapshot, error) {
		return nil, errors.New("snapshot failed")
	})

	req := httptest.NewRequest(http.MethodGet, "/stream?scope=cluster", nil)
	rec := newFlushRecorder()

	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.Contains(t, rec.Body.String(), "snapshot failed")

	summary := recorder.SnapshotSummary()
	require.Len(t, summary.Streams, 1)
	stream := summary.Streams[0]
	require.Equal(t, telemetry.StreamEvents, stream.Name)
	require.Equal(t, 0, stream.ActiveSessions)
	require.Equal(t, uint64(0), stream.TotalMessages)
	require.GreaterOrEqual(t, stream.ErrorCount, uint64(1))

	// Ensure subscription map is cleaned up
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	require.Empty(t, manager.subscribers)
}

func TestHandlerStreamsEvents(t *testing.T) {
	initialSnapshot := &refresh.Snapshot{
		Domain: "cluster-events",
		Payload: snapshot.ClusterEventsSnapshot{
			Events: []snapshot.ClusterEventEntry{{
				Kind:            "Event",
				Name:            "initial",
				ObjectNamespace: "default",
				Type:            "Normal",
				Source:          "tester",
				Reason:          "Created",
				Object:          "Pod/test",
				Message:         "initial message",
				Age:             "0s",
			}},
		},
		Stats: refresh.SnapshotStats{ItemCount: 1},
	}

	handler, manager, recorder := newTestHandler(t, func(scope string) (*refresh.Snapshot, error) {
		return initialSnapshot, nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/stream?scope=cluster", nil).WithContext(ctx)
	rec := newFlushRecorder()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		handler.ServeHTTP(rec, req)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(rec.Body.String(), "initial message")
	}, time.Second, 10*time.Millisecond)

	var ch chan StreamEvent
	require.Eventually(t, func() bool {
		manager.mu.RLock()
		defer manager.mu.RUnlock()
		subs := manager.subscribers["cluster"]
		if len(subs) == 0 {
			return false
		}
		for _, sub := range subs {
			ch = sub.ch
			return true
		}
		return false
	}, time.Second, 10*time.Millisecond)

	ch <- StreamEvent{
		Entry: Entry{
			Kind:            "Event",
			Name:            "update",
			Namespace:       "default",
			ObjectNamespace: "default",
			Type:            "Normal",
			Source:          "tester",
			Reason:          "Updated",
			Object:          "Pod/test",
			Message:         "update message",
			Age:             "1s",
			CreatedAt:       time.Now().UnixMilli(),
		},
		Sequence: 2,
	}

	require.Eventually(t, func() bool {
		body := rec.Body.String()
		return strings.Contains(body, "update message") && strings.Count(body, "event: event") >= 2
	}, time.Second, 10*time.Millisecond)

	cancel()
	wg.Wait()

	summary := recorder.SnapshotSummary()
	require.Len(t, summary.Streams, 1)
	stream := summary.Streams[0]
	require.Equal(t, uint64(2), stream.TotalMessages)
	require.Equal(t, 0, stream.ActiveSessions)
	require.Equal(t, telemetry.StreamEvents, stream.Name)
}

func TestHandlerResumesFromSince(t *testing.T) {
	var buildCalls atomic.Int32
	handler, manager, _ := newTestHandler(t, func(scope string) (*refresh.Snapshot, error) {
		buildCalls.Add(1)
		return &refresh.Snapshot{
			Domain: "cluster-events",
			Payload: snapshot.ClusterEventsSnapshot{
				Events: []snapshot.ClusterEventEntry{{
					Kind:            "Event",
					Name:            "snapshot",
					ObjectNamespace: "default",
					Type:            "Normal",
					Source:          "tester",
					Reason:          "Snapshot",
					Object:          "Pod/test",
					Message:         "snapshot message",
					Age:             "0s",
				}},
			},
			Stats: refresh.SnapshotStats{ItemCount: 1},
		}, nil
	})

	manager.broadcast("cluster", Entry{
		Kind:            "Event",
		Name:            "first",
		ObjectNamespace: "default",
		Message:         "first message",
	})
	manager.broadcast("cluster", Entry{
		Kind:            "Event",
		Name:            "second",
		ObjectNamespace: "default",
		Message:         "second message",
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/stream?scope=cluster&since=1", nil).WithContext(ctx)
	rec := newFlushRecorder()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		handler.ServeHTTP(rec, req)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(rec.Body.String(), "second message")
	}, time.Second, 10*time.Millisecond)
	require.Equal(t, int32(0), buildCalls.Load())

	cancel()
	wg.Wait()
}

func TestHandlerFallsBackToSnapshotWhenResumeTooOld(t *testing.T) {
	var buildCalls atomic.Int32
	handler, manager, _ := newTestHandler(t, func(scope string) (*refresh.Snapshot, error) {
		buildCalls.Add(1)
		return &refresh.Snapshot{
			Domain: "cluster-events",
			Payload: snapshot.ClusterEventsSnapshot{
				Events: []snapshot.ClusterEventEntry{{
					Kind:            "Event",
					Name:            "snapshot",
					ObjectNamespace: "default",
					Type:            "Normal",
					Source:          "tester",
					Reason:          "Snapshot",
					Object:          "Pod/test",
					Message:         "snapshot fallback",
					Age:             "0s",
				}},
			},
			Stats: refresh.SnapshotStats{ItemCount: 1},
		}, nil
	})

	manager.mu.Lock()
	buffer := newEventBuffer(2)
	buffer.add(bufferedEvent{
		sequence: 5,
		entry: Entry{
			Kind:            "Event",
			Name:            "buffered",
			ObjectNamespace: "default",
			Message:         "buffered message",
		},
	})
	manager.buffers["cluster"] = buffer
	manager.sequences["cluster"] = 5
	manager.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/stream?scope=cluster&since=1", nil).WithContext(ctx)
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
	require.Equal(t, int32(1), buildCalls.Load())

	cancel()
	wg.Wait()
}

func newTestHandler(t testing.TB, build func(scope string) (*refresh.Snapshot, error)) (*Handler, *Manager, *telemetry.Recorder) {
	t.Helper()
	if build == nil {
		build = func(scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "cluster-events", Payload: snapshot.ClusterEventsSnapshot{}}, nil
		}
	}

	reg := domain.New()
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "cluster-events",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return build(scope)
		},
	}))

	recorder := telemetry.NewRecorder()
	service := snapshot.NewService(reg, recorder, snapshot.ClusterMeta{})
	manager := &Manager{
		subscribers: make(map[string]map[uint64]*subscription),
		buffers:     make(map[string]*eventBuffer),
		sequences:   make(map[string]uint64),
		logger:      noopLogger{},
		telemetry:   recorder,
	}

	handler, err := NewHandler(service, manager, noopLogger{})
	require.NoError(t, err)
	return handler, manager, recorder
}
