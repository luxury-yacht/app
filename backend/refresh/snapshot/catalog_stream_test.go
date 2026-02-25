package snapshot

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
)

func TestCatalogStreamHandlerStreamsBatches(t *testing.T) {
	svc := objectcatalog.NewService(objectcatalog.Dependencies{Now: func() time.Time { return time.Now() }}, nil)
	handler := NewCatalogStreamHandler(
		func() *objectcatalog.Service { return svc },
		nil,
		telemetry.NewRecorder(),
		ClusterMeta{ClusterID: "cluster-a", ClusterName: "cluster-a"},
	)

	req := httptest.NewRequest("GET", "/?limit=10", nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req = req.WithContext(ctx)
	w := newCatalogFlushRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.ServeHTTP(w, req)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(w.BodyString(), "data:")
	}, time.Second, 10*time.Millisecond, "expected initial catalog SSE event")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("catalog stream handler did not exit after cancel")
	}

	status := w.StatusCode()
	if status != 0 && status != 200 {
		t.Fatalf("expected streaming response, got status %d", status)
	}

	body := w.BodyString()
	scanner := bufio.NewScanner(strings.NewReader(body))
	var events []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			events = append(events, line)
		}
	}

	if len(events) == 0 {
		t.Fatalf("expected at least one SSE event, got none")
	}

	payload := strings.TrimSpace(strings.TrimPrefix(events[0], "data:"))
	var event catalogStreamEvent
	require.NoError(t, json.Unmarshal([]byte(payload), &event))
	require.Equal(t, "cluster-a", event.Snapshot.ClusterID)
	require.Equal(t, "cluster-a", event.Snapshot.ClusterName)
}

type catalogFlushRecorder struct {
	*httptest.ResponseRecorder
	mu sync.Mutex
}

func newCatalogFlushRecorder() *catalogFlushRecorder {
	return &catalogFlushRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (r *catalogFlushRecorder) Flush() {}

// Write is synchronized so tests can safely poll BodyString while the handler streams in another goroutine.
func (r *catalogFlushRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ResponseRecorder.Write(p)
}

func (r *catalogFlushRecorder) WriteHeader(statusCode int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ResponseRecorder.WriteHeader(statusCode)
}

func (r *catalogFlushRecorder) BodyString() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Body.String()
}

func (r *catalogFlushRecorder) StatusCode() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Code
}
