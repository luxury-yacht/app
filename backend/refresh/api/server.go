package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	// CorrelationIDHeader is the HTTP header used for request correlation.
	CorrelationIDHeader = "X-Correlation-ID"
)

var (
	errDomainNotSpecified = errors.New("domain not specified")
	errJobIDNotSpecified  = errors.New("job id not specified")
)

// Server exposes HTTP endpoints for snapshot retrieval and manual refresh.
type Server struct {
	registry  *domain.Registry
	snapshots refresh.SnapshotService
	queue     refresh.ManualQueue
	telemetry *telemetry.Recorder
}

// NewServer constructs an API server instance.
func NewServer(reg *domain.Registry, snapshots refresh.SnapshotService, queue refresh.ManualQueue, recorder *telemetry.Recorder) *Server {
	return &Server{
		registry:  reg,
		snapshots: snapshots,
		queue:     queue,
		telemetry: recorder,
	}
}

// Register attaches the API routes to the provided mux.
func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/v2/snapshots/", s.handleSnapshot)
	mux.HandleFunc("/api/v2/refresh/", s.handleManualRefresh)
	mux.HandleFunc("/api/v2/jobs/", s.handleJobStatus)
	mux.HandleFunc("/api/v2/telemetry/summary", s.handleTelemetrySummary)
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	if !applyCORS(w, r, http.MethodGet) {
		return
	}

	correlationID := getCorrelationID(r)

	domainName := strings.TrimPrefix(r.URL.Path, "/api/v2/snapshots/")
	if domainName == "" {
		writeError(w, http.StatusBadRequest, errDomainNotSpecified, correlationID)
		return
	}

	scope := r.URL.Query().Get("scope")

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	snapshot, err := s.snapshots.Build(ctx, domainName, scope)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err, correlationID)
		return
	}

	ifNoneMatch := r.Header.Get("If-None-Match")
	if ifNoneMatch != "" && snapshot.Checksum != "" && ifNoneMatch == snapshot.Checksum {
		setCorrelationID(w, correlationID)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	setCorrelationID(w, correlationID)
	w.Header().Set("Content-Type", "application/json")
	if snapshot.Checksum != "" {
		w.Header().Set("ETag", snapshot.Checksum)
	}
	if err := json.NewEncoder(w).Encode(snapshot); err != nil {
		writeError(w, http.StatusInternalServerError, err, correlationID)
	}
}

func (s *Server) handleManualRefresh(w http.ResponseWriter, r *http.Request) {
	if !applyCORS(w, r, http.MethodPost) {
		return
	}

	correlationID := getCorrelationID(r)

	if r.Method != http.MethodPost {
		setCorrelationID(w, correlationID)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	domainName := strings.TrimPrefix(r.URL.Path, "/api/v2/refresh/")
	if domainName == "" {
		writeError(w, http.StatusBadRequest, errDomainNotSpecified, correlationID)
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

	job, err := s.queue.Enqueue(r.Context(), domainName, body.Scope, body.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, err, correlationID)
		return
	}

	setCorrelationID(w, correlationID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(job)
}

func (s *Server) handleJobStatus(w http.ResponseWriter, r *http.Request) {
	if !applyCORS(w, r, http.MethodGet) {
		return
	}

	correlationID := getCorrelationID(r)

	jobID := strings.TrimPrefix(r.URL.Path, "/api/v2/jobs/")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, errJobIDNotSpecified, correlationID)
		return
	}

	job, ok := s.queue.Status(jobID)
	if !ok {
		setCorrelationID(w, correlationID)
		http.NotFound(w, r)
		return
	}
	setCorrelationID(w, correlationID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(job)
}

func (s *Server) handleTelemetrySummary(w http.ResponseWriter, r *http.Request) {
	if !applyCORS(w, r, http.MethodGet) {
		return
	}

	correlationID := getCorrelationID(r)
	setCorrelationID(w, correlationID)

	if s.telemetry == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(telemetry.Summary{})
		return
	}

	summary := s.telemetry.SnapshotSummary()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(summary)
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

func writeError(w http.ResponseWriter, status int, err error, correlationID string) {
	w.Header().Set("Content-Type", "application/json")
	setCorrelationID(w, correlationID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Code          string `json:"code"`
		Message       string `json:"message"`
		RetryAfterSec int    `json:"retryAfterSeconds,omitempty"`
		CorrelationID string `json:"correlationId,omitempty"`
	}{
		Code:          http.StatusText(status),
		Message:       err.Error(),
		CorrelationID: correlationID,
	})
}

func applyCORS(w http.ResponseWriter, r *http.Request, allowedMethods ...string) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}

	if r.Method == http.MethodOptions {
		allowMethods := strings.Join(append(allowedMethods, http.MethodOptions), ", ")
		w.Header().Set("Access-Control-Allow-Methods", allowMethods)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	return true
}
