package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

type flushRecorder struct {
	*httptest.ResponseRecorder
	mu sync.Mutex
}

func newFlushRecorder() *flushRecorder {
	return &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (f *flushRecorder) Flush() {}

// Write is synchronized so tests can safely poll BodyString while handlers stream in another goroutine.
func (f *flushRecorder) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ResponseRecorder.Write(p)
}

func (f *flushRecorder) BodyString() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Body.String()
}

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

func TestAggregateEventStreamHandlerStreamsSingleCluster(t *testing.T) {
	initialTimestamp := time.Now().Add(-2 * time.Hour)
	service := stubSnapshotService{
		build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{
				Domain: domain,
				Payload: snapshot.ClusterEventsSnapshot{
					Events: []snapshot.ClusterEventEntry{{
						ClusterMeta:  snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
						Message:      "initial message",
						AgeTimestamp: initialTimestamp.UnixMilli(),
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
	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/events?scope=cluster-a|cluster", nil).WithContext(ctx)
	rec := newFlushRecorder()

	go handler.ServeHTTP(rec, req)

	require.Eventually(t, func() bool {
		return strings.Contains(rec.BodyString(), "initial message")
	}, time.Second, 10*time.Millisecond)
	require.Contains(t, rec.BodyString(), `"createdAt":`+strconv.FormatInt(initialTimestamp.UnixMilli(), 10))

	managerA.mu.Lock()
	require.Equal(t, "cluster", managerA.scope)
	managerA.mu.Unlock()

	managerB.mu.Lock()
	require.Empty(t, managerB.scope)
	managerB.mu.Unlock()

	liveLink := resourcemodel.NewNamespacedResourceLink("", "", "v1", "Pod", "pods", "default", "web", "pod-uid-live")
	managerA.ch <- eventstream.StreamEvent{Entry: eventstream.Entry{Message: "event-a", InvolvedObject: &liveLink}, Sequence: 2}

	require.Eventually(t, func() bool {
		body := rec.BodyString()
		return strings.Contains(body, "event-a") &&
			strings.Contains(body, `"clusterId":"cluster-a"`) &&
			strings.Contains(body, `"involvedObject":{"ref":{"clusterId":"cluster-a"`)
	}, time.Second, 10*time.Millisecond)

	var bufferedClusterID string
	var bufferedLinkClusterID string
	handler.mu.Lock()
	if buffer := handler.buffers["cluster-a|cluster"]; buffer != nil {
		for i := 0; i < buffer.count; i++ {
			item := buffer.items[(buffer.start+i)%buffer.max]
			if item.Entry.Message != "event-a" {
				continue
			}
			bufferedClusterID = item.Entry.ClusterID
			if item.Entry.InvolvedObject != nil && item.Entry.InvolvedObject.Ref != nil {
				bufferedLinkClusterID = item.Entry.InvolvedObject.Ref.ClusterID
			}
		}
	}
	handler.mu.Unlock()
	require.Equal(t, "cluster-a", bufferedClusterID)
	require.Equal(t, "cluster-a", bufferedLinkClusterID)
}

func TestAggregateEventStreamHandlerRejectsMultiClusterScope(t *testing.T) {
	service := stubSnapshotService{}
	managerA := &stubEventManager{ch: make(chan eventstream.StreamEvent, 1)}
	managerB := &stubEventManager{ch: make(chan eventstream.StreamEvent, 1)}
	handler := newAggregateEventStreamHandler(
		service,
		map[string]eventStreamSubscriber{
			"cluster-a": managerA,
			"cluster-b": managerB,
		},
		map[string]snapshot.ClusterMeta{
			"cluster-a": {ClusterID: "cluster-a", ClusterName: "alpha"},
			"cluster-b": {ClusterID: "cluster-b", ClusterName: "bravo"},
		},
		[]string{"cluster-a", "cluster-b"},
		nil,
		noopLogger{},
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/events?scope=clusters=cluster-a,cluster-b|cluster", nil)
	rec := newFlushRecorder()

	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.BodyString(), "event stream requires a single cluster scope")

	managerA.mu.Lock()
	require.Empty(t, managerA.scope)
	managerA.mu.Unlock()

	managerB.mu.Lock()
	require.Empty(t, managerB.scope)
	managerB.mu.Unlock()
}

func TestConvertAggregateSnapshotPreservesEventObjectIdentity(t *testing.T) {
	clusterLink := resourcemodel.NewClusterResourceLink("", "", "v1", "Node", "nodes", "node-a", "node-uid")
	clusterEntries := convertAggregateSnapshot(&refresh.Snapshot{
		Payload: snapshot.ClusterEventsSnapshot{
			Events: []snapshot.ClusterEventEntry{{
				ClusterMeta:      snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
				Name:             "cluster-event",
				ObjectUID:        "node-uid",
				ObjectAPIVersion: "v1",
				InvolvedObject:   &clusterLink,
			}},
		},
	})
	require.Len(t, clusterEntries, 1)
	require.Equal(t, "node-uid", clusterEntries[0].ObjectUID)
	require.Equal(t, "v1", clusterEntries[0].ObjectAPIVersion)
	require.NotNil(t, clusterEntries[0].InvolvedObject)
	require.NotNil(t, clusterEntries[0].InvolvedObject.Ref)
	require.Equal(t, "cluster-a", clusterEntries[0].InvolvedObject.Ref.ClusterID)

	namespaceLink := resourcemodel.NewNamespacedResourceLink("", "batch", "v1", "Job", "jobs", "default", "sync", "job-uid")
	namespaceEntries := convertAggregateSnapshot(&refresh.Snapshot{
		Payload: snapshot.NamespaceEventsSnapshot{
			Events: []snapshot.EventSummary{{
				ClusterMeta:      snapshot.ClusterMeta{ClusterID: "cluster-b", ClusterName: "bravo"},
				Name:             "namespace-event",
				ObjectUID:        "job-uid",
				ObjectAPIVersion: "batch/v1",
				InvolvedObject:   &namespaceLink,
			}},
		},
	})
	require.Len(t, namespaceEntries, 1)
	require.Equal(t, "job-uid", namespaceEntries[0].ObjectUID)
	require.Equal(t, "batch/v1", namespaceEntries[0].ObjectAPIVersion)
	require.NotNil(t, namespaceEntries[0].InvolvedObject)
	require.NotNil(t, namespaceEntries[0].InvolvedObject.Ref)
	require.Equal(t, "cluster-b", namespaceEntries[0].InvolvedObject.Ref.ClusterID)
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
		return strings.Contains(rec.BodyString(), "buffered")
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
		return strings.Contains(rec.BodyString(), "snapshot fallback")
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
	require.Contains(t, rec.BodyString(), "event: event")
	require.Contains(t, rec.BodyString(), "id: 5")
	require.Contains(t, rec.BodyString(), "\"sequence\":5")
}

func TestNoopLoggerDoesNothing(t *testing.T) {
	logger := noopLogger{}
	logger.Debug("debug")
	logger.Info("info")
	logger.Warn("warn")
	logger.Error("error")
}
