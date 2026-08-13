package system

import (
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// streamDeps bundles dependencies required to wire refresh stream handlers.
type streamDeps struct {
	informerFactory *informer.Factory
	ingestManager   *ingest.IngestManager
	snapshotService refresh.SnapshotBuilder
	metricsProvider metrics.Provider
	cfg             Config
	telemetry       *telemetry.Recorder
	clusterMeta     snapshot.ClusterMeta
}

// registerStreamHandlers constructs the per-cluster producers consumed by the
// process-wide Wails named streams.
func registerStreamHandlers(deps streamDeps) (*containerlogsstream.Handler, *eventstream.Manager, *resourcestream.Manager, error) {
	logger := applog.ClusterScoped(deps.cfg.Logger, deps.clusterMeta.ClusterID, deps.clusterMeta.ClusterName)
	logHandler, err := containerlogsstream.NewHandler(
		deps.cfg.KubernetesClient,
		logger,
		deps.telemetry,
		deps.cfg.ContainerLogsTargetLimiter,
	)
	if err != nil {
		return nil, nil, nil, err
	}

	eventManager := eventstream.NewManager(
		deps.informerFactory.SharedInformerFactory().Core().V1().Events(),
		logger,
		deps.telemetry,
		deps.clusterMeta.ClusterID,
	)

	resourceManager := resourcestream.NewManager(
		deps.informerFactory,
		logger,
		deps.telemetry,
		deps.clusterMeta,
		deps.cfg.DynamicClient,
		deps.ingestManager,
		deps.cfg.AllowedNamespaces...,
	)
	return logHandler, eventManager, resourceManager, nil
}
