package system

import (
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// MuxConfig groups the dependencies needed to wire core refresh HTTP routes.
type MuxConfig struct {
	SnapshotService refresh.SnapshotService
	ManualQueue     refresh.ManualQueue
	Telemetry       telemetry.Summarizer
	Metrics         refresh.ClusterMetricsDemandController
	HealthHub       refresh.InformerHub
}

type singleClusterMetricsDemandController struct {
	clusterID string
	manager   *refresh.Manager
}

func (c singleClusterMetricsDemandController) SetMetricsActiveForClusters(clusterIDs []string) {
	active := false
	for _, clusterID := range clusterIDs {
		if clusterID == c.clusterID {
			active = true
			break
		}
	}
	c.manager.SetMetricsActive(active)
}

// BuildRefreshMux constructs a ServeMux with the refresh API and optional health route.
func BuildRefreshMux(cfg MuxConfig) *http.ServeMux {
	mux := http.NewServeMux()
	if cfg.HealthHub != nil {
		mux.HandleFunc("/healthz/refresh", HealthHandler(cfg.HealthHub))
	}
	api.NewServer(cfg.SnapshotService, cfg.ManualQueue, cfg.Telemetry, cfg.Metrics).Register(mux)
	return mux
}
