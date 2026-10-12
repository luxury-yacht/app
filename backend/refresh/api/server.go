package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	// CorrelationIDHeader is the HTTP header used for request correlation.
	CorrelationIDHeader   = "X-Correlation-ID"
	jsonContentTypeHeader = "Content-Type"
	jsonContentType       = "application/json"
)

// Requests this API rejects itself are BadRequest statuses, so they keep their 400.
var (
	errDomainNotSpecified = errorstatus.BadRequest(errors.New("domain not specified"))
	errJobIDNotSpecified  = errorstatus.BadRequest(errors.New("job id not specified"))
	errClusterScopeNeeded = errorstatus.BadRequest(errors.New("cluster scope is required"))
	errSingleClusterScope = errorstatus.BadRequest(errors.New("single cluster scope is required"))
	errClusterIDsNeeded   = errorstatus.BadRequest(errors.New("clusterIds is required"))
)

// Server exposes HTTP endpoints for snapshot retrieval and manual refresh.
type Server struct {
	snapshots refresh.SnapshotBuilder
	queue     refresh.ManualQueue
	telemetry telemetry.Summarizer
	metrics   refresh.ClusterMetricsDemandController
}

// NewServer constructs an API server instance.
func NewServer(
	snapshots refresh.SnapshotBuilder,
	queue refresh.ManualQueue,
	recorder telemetry.Summarizer,
	metrics refresh.ClusterMetricsDemandController,
) *Server {
	return &Server{
		snapshots: snapshots,
		queue:     queue,
		telemetry: recorder,
		metrics:   metrics,
	}
}

// Register attaches the API routes to the provided mux.
func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("/snapshots/", s.handleSnapshot)
	mux.HandleFunc("/refresh/", s.handleManualRefresh)
	mux.HandleFunc("/jobs/", s.handleJobStatus)
	mux.HandleFunc("/telemetry/summary", s.handleTelemetrySummary)
	mux.HandleFunc("/metrics/active", s.handleMetricsActive)
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	correlationID := getCorrelationID(r)

	domainName := strings.TrimPrefix(r.URL.Path, "/snapshots/")
	if domainName == "" {
		writeError(w, errDomainNotSpecified, correlationID)
		return
	}

	scope := r.URL.Query().Get("scope")
	if err := requireClusterScope(scope); err != nil {
		writeError(w, err, correlationID)
		return
	}

	requestContext := applog.ContextWithOperationID(r.Context(), correlationID)
	ctx, cancel := context.WithCancel(requestContext)
	defer cancel()

	snapshot, err := s.snapshots.Build(ctx, domainName, scope)
	if err != nil {
		writeSnapshotBuildError(w, err, domainName, correlationID)
		return
	}

	validator := snapshot.SourceVersion
	if validator == "" {
		validator = snapshot.Checksum
	}
	ifNoneMatch := r.Header.Get("If-None-Match")
	if ifNoneMatch != "" && validator != "" && ifNoneMatch == validator {
		setCorrelationID(w, correlationID)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	setCorrelationID(w, correlationID)
	w.Header().Set(jsonContentTypeHeader, jsonContentType)
	if validator != "" {
		w.Header().Set("ETag", validator)
	}
	if err := json.NewEncoder(w).Encode(snapshot); err != nil {
		writeError(w, err, correlationID)
	}
}

// writeSnapshotBuildError names the requested domain on an API denial that
// does not already carry the app's permission details.
func writeSnapshotBuildError(w http.ResponseWriter, err error, domainName, correlationID string) {
	if apierrors.IsForbidden(err) && !errorstatus.IsPermissionDenied(err) {
		err = errorstatus.WrapPermissionDenied(err, domainName, "")
	}
	writeError(w, err, correlationID)
}

func (s *Server) handleManualRefresh(w http.ResponseWriter, r *http.Request) {
	correlationID := getCorrelationID(r)

	if r.Method != http.MethodPost {
		setCorrelationID(w, correlationID)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	domainName := strings.TrimPrefix(r.URL.Path, "/refresh/")
	if domainName == "" {
		writeError(w, errDomainNotSpecified, correlationID)
		return
	}

	var body struct {
		Scope  string `json:"scope"`
		Reason string `json:"reason"`
	}
	if r.Body != nil {
		defer r.Body.Close()
		data, _ := io.ReadAll(r.Body)
		if len(data) > 0 {
			_ = json.Unmarshal(data, &body)
		}
	}
	if err := requireClusterScope(body.Scope); err != nil {
		writeError(w, err, correlationID)
		return
	}

	requestContext := applog.ContextWithOperationID(r.Context(), correlationID)
	job, err := s.queue.Enqueue(requestContext, domainName, body.Scope, body.Reason)
	if err != nil {
		writeError(w, enqueueRejection(err), correlationID)
		return
	}

	setCorrelationID(w, correlationID)
	w.Header().Set(jsonContentTypeHeader, jsonContentType)
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(job)
}

// enqueueRejection keeps a typed enqueue failure's status; any other refusal
// is a rejected request, as this endpoint has always answered it.
func enqueueRejection(err error) error {
	if errorstatus.Classify(err).Reason != errorstatus.ReasonUnknown {
		return err
	}
	return errorstatus.BadRequest(err)
}

func requireClusterScope(scope string) error {
	clusterIDs, _ := refresh.SplitClusterScopeList(scope)
	if len(clusterIDs) == 0 {
		return errClusterScopeNeeded
	}
	if len(clusterIDs) > 1 {
		return errSingleClusterScope
	}
	return nil
}

func (s *Server) handleJobStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	correlationID := getCorrelationID(r)

	jobID := strings.TrimPrefix(r.URL.Path, "/jobs/")
	if jobID == "" {
		writeError(w, errJobIDNotSpecified, correlationID)
		return
	}

	job, ok := s.queue.Status(jobID)
	if !ok {
		writeError(w, errorstatus.NotFound(fmt.Errorf("refresh job %s not found", jobID)), correlationID)
		return
	}
	setCorrelationID(w, correlationID)
	w.Header().Set(jsonContentTypeHeader, jsonContentType)
	_ = json.NewEncoder(w).Encode(job)
}

func (s *Server) handleTelemetrySummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	correlationID := getCorrelationID(r)
	setCorrelationID(w, correlationID)

	if s.telemetry == nil {
		w.Header().Set(jsonContentTypeHeader, jsonContentType)
		_ = json.NewEncoder(w).Encode(telemetry.EmptySummary())
		return
	}

	summary := s.telemetry.SnapshotSummary()
	w.Header().Set(jsonContentTypeHeader, jsonContentType)
	_ = json.NewEncoder(w).Encode(summary)
}

func (s *Server) handleMetricsActive(w http.ResponseWriter, r *http.Request) {
	correlationID := getCorrelationID(r)

	if r.Method != http.MethodPost {
		setCorrelationID(w, correlationID)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		ClusterIDs *[]string `json:"clusterIds"`
	}
	if r.Body != nil {
		defer r.Body.Close()
		data, _ := io.ReadAll(r.Body)
		if len(data) > 0 {
			if err := json.Unmarshal(data, &body); err != nil {
				writeError(w, errorstatus.BadRequest(err), correlationID)
				return
			}
		}
	}

	if body.ClusterIDs == nil {
		writeError(w, errClusterIDsNeeded, correlationID)
		return
	}
	if s.metrics != nil {
		s.metrics.SetMetricsActiveForClusters(*body.ClusterIDs)
	}

	setCorrelationID(w, correlationID)
	w.WriteHeader(http.StatusNoContent)
}

// getCorrelationID extracts the correlation ID from the request header or generates a new one.
func getCorrelationID(r *http.Request) string {
	if id := r.Header.Get(CorrelationIDHeader); id != "" {
		return id
	}
	return uuid.NewString()[:8] // Short 8-char ID for readability
}

// setCorrelationID sets the correlation ID on the response header.
func setCorrelationID(w http.ResponseWriter, correlationID string) {
	if correlationID != "" {
		w.Header().Set(CorrelationIDHeader, correlationID)
	}
}

// WriteError answers a refresh request with err's typed status; the status code
// is the response code. It is exported for the transport that fronts this API.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	writeError(w, err, getCorrelationID(r))
}

func writeError(w http.ResponseWriter, err error, correlationID string) {
	status := errorstatus.Classify(err)
	code := status.Code
	if code == 0 {
		code = http.StatusInternalServerError
	}
	w.Header().Set(jsonContentTypeHeader, jsonContentType)
	setCorrelationID(w, correlationID)
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(struct {
		errorstatus.Status
		CorrelationID string `json:"correlationId,omitempty"`
	}{Status: status, CorrelationID: correlationID})
}
