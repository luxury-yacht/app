package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

type fakeSnapshotService struct {
	snapshot *refresh.Snapshot
}

func (f *fakeSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	snap := *f.snapshot
	snap.Domain = domain
	snap.Scope = scope
	return &snap, nil
}

type errorSnapshotService struct {
	err error
}

func (f *errorSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	return nil, f.err
}

type fakeQueue struct {
	job *refresh.ManualRefreshJob
}

func (q *fakeQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	job := &refresh.ManualRefreshJob{ID: "job-1", Domain: domain, Scope: scope, QueuedAt: 1, State: refresh.JobStateQueued}
	q.job = job
	return job, nil
}

func (q *fakeQueue) Status(jobID string) (*refresh.ManualRefreshJob, bool) {
	if q.job != nil && q.job.ID == jobID {
		return q.job, true
	}
	return nil, false
}

func (q *fakeQueue) Update(job *refresh.ManualRefreshJob) {
	q.job = job
}

func (q *fakeQueue) Next(ctx context.Context) (*refresh.ManualRefreshJob, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

type errorQueue struct{}

func (errorQueue) Enqueue(context.Context, string, string, string) (*refresh.ManualRefreshJob, error) {
	return nil, errors.New("enqueue failed")
}

func (errorQueue) Status(string) (*refresh.ManualRefreshJob, bool) { return nil, false }

func (errorQueue) Update(*refresh.ManualRefreshJob) {}

func (errorQueue) Next(ctx context.Context) (*refresh.ManualRefreshJob, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

type fakeMetricsController struct {
	activeValues []bool
}

func (f *fakeMetricsController) SetMetricsActive(active bool) {
	f.activeValues = append(f.activeValues, active)
}

func TestSnapshotEndpoint(t *testing.T) {
	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 got %d", rr.Code)
	}

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "wails://test" {
		t.Fatalf("expected CORS header to echo origin, got %q", got)
	}

	var snap refresh.Snapshot
	if err := json.Unmarshal(rr.Body.Bytes(), &snap); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if snap.Domain != "nodes" {
		t.Fatalf("unexpected domain %s", snap.Domain)
	}
}

func TestSnapshotPermissionDenied(t *testing.T) {
	svc := &errorSnapshotService{
		err: refresh.NewPermissionDeniedError("nodes", "core/nodes"),
	}
	server := api.NewServer(svc, &fakeQueue{}, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 got %d", rr.Code)
	}

	var payload refresh.PermissionDeniedStatus
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if payload.Reason != "Forbidden" || payload.Code != http.StatusForbidden {
		t.Fatalf("unexpected status payload: %+v", payload)
	}
	if payload.Details.Domain != "nodes" || payload.Details.Resource != "core/nodes" {
		t.Fatalf("unexpected details: %+v", payload.Details)
	}
}

func TestSnapshotEndpointRejectsMissingClusterScope(t *testing.T) {
	// Snapshot requests must provide an explicit cluster scope.
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/snapshots/nodes", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 got %d", rr.Code)
	}

	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error payload: %v", err)
	}
	if !strings.Contains(payload.Message, "cluster scope is required") {
		t.Fatalf("unexpected error message: %s", payload.Message)
	}
}

func snapshotService() refresh.SnapshotService {
	return &fakeSnapshotService{snapshot: &refresh.Snapshot{Version: 1, Payload: map[string]int{"items": 1}}}
}

func TestManualRefreshEndpoint(t *testing.T) {
	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/refresh/nodes", strings.NewReader(`{"scope":"cluster-a|default"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Fatalf("expected status 202 got %d", rr.Code)
	}

	var job refresh.ManualRefreshJob
	if err := json.Unmarshal(rr.Body.Bytes(), &job); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if job.State != refresh.JobStateQueued {
		t.Fatalf("expected job state queued, got %s", job.State)
	}
}

func TestManualRefreshEndpointRejectsMissingClusterScope(t *testing.T) {
	// Manual refresh must provide an explicit cluster scope.
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/refresh/nodes", nil)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 got %d", rr.Code)
	}

	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error payload: %v", err)
	}
	if !strings.Contains(payload.Message, "cluster scope is required") {
		t.Fatalf("unexpected error message: %s", payload.Message)
	}
}

func TestManualRefreshHandlesQueueErrors(t *testing.T) {
	svc := snapshotService()
	server := api.NewServer(svc, errorQueue{}, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/refresh/nodes", strings.NewReader(`{"scope":"cluster-a|default"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 got %d", rr.Code)
	}

	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected json response, got %s", ct)
	}

	var payload map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if payload["message"] != "enqueue failed" {
		t.Fatalf("expected error message, got %v", payload["message"])
	}
}

func TestOptionsPreflight(t *testing.T) {
	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodOptions, "/api/v2/refresh/nodes", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 got %d", rr.Code)
	}

	if allow := rr.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(allow, http.MethodPost) {
		t.Fatalf("expected allowed methods to include POST, got %q", allow)
	}
}

func TestTelemetrySummary(t *testing.T) {
	recorder := telemetry.NewRecorder()
	recorder.RecordSnapshot("nodes", "", "test-cluster", "test", 50*time.Millisecond, nil, false, 0, nil, 0, 0, 0, true, 50)
	recorder.RecordMetrics(25*time.Millisecond, time.Now(), nil, 0, true)

	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, recorder, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/telemetry/summary", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 got %d", rr.Code)
	}

	var summary telemetry.Summary
	if err := json.Unmarshal(rr.Body.Bytes(), &summary); err != nil {
		t.Fatalf("failed to decode summary: %v", err)
	}

	if len(summary.Snapshots) != 1 {
		t.Fatalf("expected 1 snapshot summary, got %d", len(summary.Snapshots))
	}
	if summary.Snapshots[0].Domain != "nodes" {
		t.Fatalf("unexpected domain %s", summary.Snapshots[0].Domain)
	}
}

func TestMetricsActiveEndpoint(t *testing.T) {
	controller := &fakeMetricsController{}
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, controller)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/metrics/active", strings.NewReader(`{"active":true}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 got %d", rr.Code)
	}
	if len(controller.activeValues) != 1 || controller.activeValues[0] != true {
		t.Fatalf("expected metrics controller to receive active=true")
	}
}

func TestJobStatusEndpoint(t *testing.T) {
	job := &refresh.ManualRefreshJob{ID: "job-42", Domain: "nodes", State: refresh.JobStateQueued}
	queue := &fakeQueue{job: job}

	server := api.NewServer(snapshotService(), queue, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/jobs/job-42", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 got %d", rr.Code)
	}

	var returned refresh.ManualRefreshJob
	if err := json.Unmarshal(rr.Body.Bytes(), &returned); err != nil {
		t.Fatalf("failed to decode job: %v", err)
	}
	if returned.ID != job.ID {
		t.Fatalf("expected job id %s got %s", job.ID, returned.ID)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v2/jobs/unknown", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 got %d", rr.Code)
	}
}
