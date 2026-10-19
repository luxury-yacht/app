package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

type fakeSnapshotService struct {
	snapshot *refresh.Snapshot
	context  context.Context
}

func (f *fakeSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	f.context = ctx
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
	job     *refresh.ManualRefreshJob
	context context.Context
}

func (q *fakeQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	q.context = ctx
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

type fakeClusterMetricsController struct {
	clusterIDs [][]string
}

func (f *fakeClusterMetricsController) SetMetricsActiveForClusters(clusterIDs []string) {
	f.clusterIDs = append(f.clusterIDs, append([]string(nil), clusterIDs...))
}

func TestSnapshotEndpoint(t *testing.T) {
	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 got %d", rr.Code)
	}

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected same-origin service response without CORS header, got %q", got)
	}

	var snap refresh.Snapshot
	if err := json.Unmarshal(rr.Body.Bytes(), &snap); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if snap.Domain != "nodes" {
		t.Fatalf("unexpected domain %s", snap.Domain)
	}
}

func TestSnapshotEndpointRejectsCrossOriginPreflight(t *testing.T) {
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodOptions, "/snapshots/nodes", nil)
	req.Header.Set("Origin", "wails://test")
	req.Header.Set("Access-Control-Request-Headers", api.CorrelationIDHeader)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405 got %d", rr.Code)
	}
	if allowedHeaders := rr.Header().Get("Access-Control-Allow-Headers"); allowedHeaders != "" {
		t.Fatalf("expected no CORS allow-list, got %q", allowedHeaders)
	}
}

func TestSnapshotEndpointPropagatesCorrelationIDAsOperation(t *testing.T) {
	svc := &fakeSnapshotService{snapshot: &refresh.Snapshot{Version: 1}}
	server := api.NewServer(svc, &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set(api.CorrelationIDHeader, "broker-read-12")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if got := applog.OperationIDFromContext(svc.context); got != "broker-read-12" {
		t.Fatalf("expected snapshot context operation id, got %q", got)
	}
}

func TestSnapshotEndpointUsesSourceVersionForETagAndNotModified(t *testing.T) {
	svc := &fakeSnapshotService{snapshot: &refresh.Snapshot{
		Version:       1,
		SourceVersion: "src-v1",
		Checksum:      "payload-checksum",
		Payload:       map[string]int{"items": 1},
	}}
	server := api.NewServer(svc, &fakeQueue{}, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 got %d", rr.Code)
	}
	if got := rr.Header().Get("ETag"); got != "src-v1" {
		t.Fatalf("expected sourceVersion ETag, got %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set("If-None-Match", "payload-checksum")
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("checksum must not drive 304, got %d", rr.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set("If-None-Match", "src-v1")
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotModified {
		t.Fatalf("expected status 304 got %d", rr.Code)
	}
}

func TestSnapshotPermissionDenied(t *testing.T) {
	svc := &errorSnapshotService{
		err: errorstatus.NewPermissionDenied("nodes", "core/nodes"),
	}
	server := api.NewServer(svc, &fakeQueue{}, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 got %d", rr.Code)
	}

	payload := decodeErrorStatus(t, rr)
	if payload.Reason != errorstatus.ReasonForbidden || payload.Code != http.StatusForbidden {
		t.Fatalf("unexpected status payload: %+v", payload)
	}
	if payload.Details == nil || payload.Details.Domain != "nodes" || payload.Details.Resource != "core/nodes" {
		t.Fatalf("unexpected details: %+v", payload.Details)
	}
}

func TestSnapshotEndpointRejectsMissingClusterScope(t *testing.T) {
	// Snapshot requests must provide an explicit cluster scope.
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/snapshots/nodes", nil)
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

type recordingSnapshotService struct {
	calls int
}

func (f *recordingSnapshotService) Build(context.Context, string, string) (*refresh.Snapshot, error) {
	f.calls++
	return &refresh.Snapshot{}, nil
}

func TestRefreshRequestsRejectScopesOutsideTheDomainGrammar(t *testing.T) {
	for _, scope := range []string{"cluster-a|namespace:*", "cluster-a|default", "cluster-a|node:worker-1?limit=5"} {
		svc := &recordingSnapshotService{}
		queue := &fakeQueue{}
		server := api.NewServer(svc, queue, nil, nil)
		mux := http.NewServeMux()
		server.Register(mux)

		snapshotRequest := httptest.NewRequest(http.MethodGet, "/snapshots/namespace-config?scope="+url.QueryEscape(scope), nil)
		snapshotResponse := httptest.NewRecorder()
		mux.ServeHTTP(snapshotResponse, snapshotRequest)

		refreshRequest := httptest.NewRequest(http.MethodPost, "/refresh/namespace-config", strings.NewReader(`{"scope":"`+scope+`"}`))
		refreshResponse := httptest.NewRecorder()
		mux.ServeHTTP(refreshResponse, refreshRequest)

		if snapshotResponse.Code != http.StatusBadRequest || refreshResponse.Code != http.StatusBadRequest {
			t.Fatalf("scope %q: expected 400/400, got %d/%d", scope, snapshotResponse.Code, refreshResponse.Code)
		}
		if svc.calls != 0 || queue.job != nil {
			t.Fatalf("scope %q reached the builder or queue", scope)
		}
	}
}

func snapshotService() refresh.SnapshotBuilder {
	return &fakeSnapshotService{snapshot: &refresh.Snapshot{Version: 1, Payload: map[string]int{"items": 1}}}
}

func TestManualRefreshEndpoint(t *testing.T) {
	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, nil, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/refresh/nodes", strings.NewReader(`{"scope":"cluster-a|"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "wails://test")
	req.Header.Set(api.CorrelationIDHeader, "broker-read-manual")
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
	if got := applog.OperationIDFromContext(queue.context); got != "broker-read-manual" {
		t.Fatalf("expected manual queue context operation ID, got %q", got)
	}
}

func TestManualRefreshEndpointRejectsMissingClusterScope(t *testing.T) {
	// Manual refresh must provide an explicit cluster scope.
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/refresh/nodes", nil)
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

	req := httptest.NewRequest(http.MethodPost, "/refresh/nodes", strings.NewReader(`{"scope":"cluster-a|"}`))
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

func TestManualRefreshRejectsCrossOriginPreflight(t *testing.T) {
	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodOptions, "/refresh/nodes", nil)
	req.Header.Set("Origin", "wails://test")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405 got %d", rr.Code)
	}

	if allow := rr.Header().Get("Access-Control-Allow-Methods"); allow != "" {
		t.Fatalf("expected no CORS allow-list, got %q", allow)
	}
}

func TestTelemetrySummary(t *testing.T) {
	recorder := telemetry.NewRecorder()
	recorder.RecordSnapshot(telemetry.SnapshotRecord{Domain: "nodes", Scope: "", ClusterID: "test-cluster", ClusterName: "test", Duration: 50 * time.Millisecond, Err: nil, Truncated: false, TotalItems: 0, Warnings: nil, BatchIndex: 0, TotalBatches: 0, BatchSize: 0, IsFinal: true, TimeToFirstBatchMs: 50, InformerSyncWaitMs: 0})
	recorder.RecordMetrics(25*time.Millisecond, time.Now(), nil, 0, true)

	svc := snapshotService()
	queue := &fakeQueue{}
	server := api.NewServer(svc, queue, recorder, nil)

	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/telemetry/summary", nil)
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

func TestTelemetrySummaryWithoutRecorderReturnsEmptyArrays(t *testing.T) {
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/telemetry/summary", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	var payload map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode telemetry fallback: %v", err)
	}
	for _, field := range []string{"snapshots", "streams"} {
		items, ok := payload[field].([]any)
		if !ok || len(items) != 0 {
			t.Fatalf("expected %s to be an empty array, got %#v", field, payload[field])
		}
	}
}

func TestMetricsActiveEndpointRequiresClusterIDs(t *testing.T) {
	controller := &fakeClusterMetricsController{}
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, controller)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/metrics/active", strings.NewReader(`{"active":true}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 got %d", rr.Code)
	}
	if len(controller.clusterIDs) != 0 {
		t.Fatalf("expected legacy metrics demand to be rejected")
	}
}

func TestMetricsActiveEndpointRoutesClusterScopedDemand(t *testing.T) {
	controller := &fakeClusterMetricsController{}
	server := api.NewServer(snapshotService(), &fakeQueue{}, nil, controller)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/metrics/active", strings.NewReader(`{"clusterIds":["cluster-b","cluster-a"]}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 got %d", rr.Code)
	}
	if len(controller.clusterIDs) != 1 {
		t.Fatalf("expected one cluster-scoped demand update, got %#v", controller.clusterIDs)
	}
	if !slices.Equal(controller.clusterIDs[0], []string{"cluster-b", "cluster-a"}) {
		t.Fatalf("unexpected cluster demand: %#v", controller.clusterIDs[0])
	}
}

func TestJobStatusEndpoint(t *testing.T) {
	job := &refresh.ManualRefreshJob{ID: "job-42", Domain: "nodes", State: refresh.JobStateQueued}
	queue := &fakeQueue{job: job}

	server := api.NewServer(snapshotService(), queue, nil, nil)
	mux := http.NewServeMux()
	server.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/jobs/job-42", nil)
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

	req = httptest.NewRequest(http.MethodGet, "/jobs/unknown", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 got %d", rr.Code)
	}
}

// decodeErrorStatus reads a refresh error response, which is always the typed
// status the frontend acts on.
func decodeErrorStatus(t *testing.T, rr *httptest.ResponseRecorder) errorstatus.Status {
	t.Helper()
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected json error body, got content type %q", ct)
	}
	var status errorstatus.Status
	if err := json.Unmarshal(rr.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to decode error status: %v", err)
	}
	if status.Kind != "Status" || status.Code != rr.Code {
		t.Fatalf("expected a Status body matching HTTP %d, got %+v", rr.Code, status)
	}
	return status
}

// A failed snapshot answers with the status of the failure, so the frontend
// can tell a deleted object, a cluster still starting, and a denial apart.
func TestSnapshotEndpointAnswersWithFailureStatus(t *testing.T) {
	for _, tt := range []struct {
		name       string
		err        error
		wantCode   int
		wantReason errorstatus.Reason
	}{
		{
			name:       "deleted object",
			err:        apierrors.NewNotFound(schema.GroupResource{Group: "apps", Resource: "deployments"}, "web"),
			wantCode:   http.StatusNotFound,
			wantReason: errorstatus.ReasonNotFound,
		},
		{
			name:       "cluster not ready",
			err:        errorstatus.ClusterNotReady(errors.New("no active clusters available (requested: [cluster-a])")),
			wantCode:   http.StatusServiceUnavailable,
			wantReason: errorstatus.ReasonClusterNotReady,
		},
		{
			name:       "API denial",
			err:        apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "", errors.New("rbac")),
			wantCode:   http.StatusForbidden,
			wantReason: errorstatus.ReasonForbidden,
		},
		{
			name:       "unclassified failure",
			err:        errors.New("informer exploded"),
			wantCode:   http.StatusInternalServerError,
			wantReason: errorstatus.ReasonUnknown,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			server := api.NewServer(&errorSnapshotService{err: tt.err}, &fakeQueue{}, nil, nil)
			mux := http.NewServeMux()
			server.Register(mux)

			req := httptest.NewRequest(http.MethodGet, "/snapshots/nodes?scope=cluster-a|", nil)
			req.Header.Set(api.CorrelationIDHeader, "corr-1")
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)

			if rr.Code != tt.wantCode {
				t.Fatalf("expected status %d got %d", tt.wantCode, rr.Code)
			}
			status := decodeErrorStatus(t, rr)
			if status.Reason != tt.wantReason || status.Message != tt.err.Error() {
				t.Fatalf("unexpected status: %+v", status)
			}
			if rr.Header().Get(api.CorrelationIDHeader) != "corr-1" {
				t.Fatalf("expected the correlation id to be echoed")
			}
			if tt.wantReason == errorstatus.ReasonForbidden &&
				(status.Details == nil || status.Details.Domain != "nodes") {
				t.Fatalf("expected the denial to name its domain, got %+v", status.Details)
			}
		})
	}
}

// Requests the refresh API rejects itself keep their 400, now as a BadRequest
// status, and an unknown job is a NotFound status.
func TestRefreshAPIRejectsRequestsWithStatus(t *testing.T) {
	for _, tt := range []struct {
		name     string
		queue    refresh.ManualQueue
		method   string
		path     string
		body     string
		wantCode int
		want     errorstatus.Reason
	}{
		{name: "snapshot without domain", method: http.MethodGet, path: "/snapshots/", wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "snapshot without cluster scope", method: http.MethodGet, path: "/snapshots/nodes", wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "refresh without domain", method: http.MethodPost, path: "/refresh/", body: `{"scope":"cluster-a|"}`, wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "refresh without cluster scope", method: http.MethodPost, path: "/refresh/nodes", wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "refresh the queue refuses", queue: errorQueue{}, method: http.MethodPost, path: "/refresh/nodes", body: `{"scope":"cluster-a|"}`, wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "refresh for a cluster not ready", queue: notReadyQueue{}, method: http.MethodPost, path: "/refresh/nodes", body: `{"scope":"cluster-a|"}`, wantCode: 503, want: errorstatus.ReasonClusterNotReady},
		{name: "job without id", method: http.MethodGet, path: "/jobs/", wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "unknown job", method: http.MethodGet, path: "/jobs/missing", wantCode: 404, want: errorstatus.ReasonNotFound},
		{name: "metrics demand that is not JSON", method: http.MethodPost, path: "/metrics/active", body: `{`, wantCode: 400, want: errorstatus.ReasonBadRequest},
		{name: "metrics demand without clusterIds", method: http.MethodPost, path: "/metrics/active", body: `{"active":true}`, wantCode: 400, want: errorstatus.ReasonBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			queue := tt.queue
			if queue == nil {
				queue = &fakeQueue{}
			}
			server := api.NewServer(snapshotService(), queue, nil, &fakeClusterMetricsController{})
			mux := http.NewServeMux()
			server.Register(mux)

			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body)))

			if rr.Code != tt.wantCode {
				t.Fatalf("expected status %d got %d", tt.wantCode, rr.Code)
			}
			if status := decodeErrorStatus(t, rr); status.Reason != tt.want {
				t.Fatalf("expected reason %s, got %+v", tt.want, status)
			}
		})
	}
}

type notReadyQueue struct{ errorQueue }

func (notReadyQueue) Enqueue(context.Context, string, string, string) (*refresh.ManualRefreshJob, error) {
	return nil, errorstatus.ClusterNotReady(errors.New("cluster cluster-a not active"))
}
