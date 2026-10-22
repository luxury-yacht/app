package system

import (
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// MuxConfig groups the dependencies needed to wire core refresh HTTP routes.
type MuxConfig struct {
	SnapshotService refresh.SnapshotBuilder
	ManualQueue     refresh.ManualQueue
	Telemetry       telemetry.Summarizer
	Metrics         refresh.ClusterMetricsDemandController
}

// BuildRefreshMux constructs a ServeMux with the refresh API.
func BuildRefreshMux(cfg MuxConfig) *http.ServeMux {
	mux := http.NewServeMux()
	api.NewServer(cfg.SnapshotService, cfg.ManualQueue, cfg.Telemetry, cfg.Metrics).Register(mux)
	return mux
}
