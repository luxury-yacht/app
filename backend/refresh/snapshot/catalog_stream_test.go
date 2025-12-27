package snapshot

import (
	"bufio"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
)

func TestCatalogStreamHandlerStreamsBatches(t *testing.T) {
	SetClusterMeta("cluster-a", "cluster-a")
	t.Cleanup(func() { SetClusterMeta("", "") })

	svc := objectcatalog.NewService(objectcatalog.Dependencies{Now: func() time.Time { return time.Now() }}, nil)
	handler := NewCatalogStreamHandler(func() *objectcatalog.Service { return svc }, nil, telemetry.NewRecorder())

	req := httptest.NewRequest("GET", "/?limit=10", nil)
	w := httptest.NewRecorder()

	go func() {
		handler.ServeHTTP(w, req)
	}()

	// Wait for initial snapshot
	time.Sleep(100 * time.Millisecond)

	res := w.Result()
	if res.StatusCode != 0 && res.StatusCode != 200 {
		t.Fatalf("expected streaming response, got status %d", res.StatusCode)
	}

	body := w.Body.String()
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
