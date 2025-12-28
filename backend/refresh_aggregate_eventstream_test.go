package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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
	ch    chan eventstream.Entry
}

func (m *stubEventManager) Subscribe(scope string) (<-chan eventstream.Entry, context.CancelFunc) {
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

	managerA := &stubEventManager{ch: make(chan eventstream.Entry, 1)}
	managerB := &stubEventManager{ch: make(chan eventstream.Entry, 1)}
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

	managerA.ch <- eventstream.Entry{Message: "event-a"}
	managerB.ch <- eventstream.Entry{Message: "event-b"}

	require.Eventually(t, func() bool {
		body := rec.Body.String()
		return strings.Contains(body, "event-a") &&
			strings.Contains(body, "event-b") &&
			strings.Contains(body, `"clusterId":"cluster-a"`) &&
			strings.Contains(body, `"clusterId":"cluster-b"`)
	}, time.Second, 10*time.Millisecond)
}
