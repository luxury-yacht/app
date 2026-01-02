package resourcestream

import (
	"errors"
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Handler exposes the websocket resource stream endpoint.
type Handler struct {
	mux *streammux.Handler
}

// NewHandler constructs a websocket handler for resource streams.
func NewHandler(manager *Manager, logger logstream.Logger, recorder *telemetry.Recorder, meta snapshot.ClusterMeta) (*Handler, error) {
	if manager == nil {
		return nil, errors.New("resource stream manager is required")
	}
	if logger == nil {
		logger = noopLogger{}
	}
	mux, err := streammux.NewHandler(streammux.Config{
		Adapter:     NewAdapter(manager),
		Logger:      logger,
		Telemetry:   recorder,
		ClusterID:   meta.ClusterID,
		ClusterName: meta.ClusterName,
		StreamName:  telemetry.StreamResources,
		SendReset:   true,
	})
	if err != nil {
		return nil, err
	}
	return &Handler{mux: mux}, nil
}

// ServeHTTP upgrades the connection and multiplexes resource subscriptions.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mux.ServeHTTP(w, r)
}
