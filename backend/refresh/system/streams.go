package system

import (
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// streamDeps bundles dependencies required to wire refresh stream handlers.
type streamDeps struct {
	cfg         Config
	telemetry   *telemetry.Recorder
	clusterMeta snapshot.ClusterMeta
	// invalidator evicts a domain's cached snapshots before each doorbell.
	invalidator func(domain string)
}

// registerStreamHandlers constructs the per-cluster producers consumed by the
// process-wide Wails named streams.
func registerStreamHandlers(deps streamDeps) (*containerlogsstream.Handler, *resourcestream.Manager, error) {
	logger := applog.ClusterScoped(deps.cfg.Logger, deps.clusterMeta.ClusterID, deps.clusterMeta.ClusterName)
	logHandler, err := containerlogsstream.NewHandlerWithLimits(
		deps.cfg.KubernetesClient,
		kindregistry.MustLogTargets(),
		logger,
		deps.telemetry,
		deps.cfg.ContainerLogsPerScopeLimit,
		deps.cfg.ContainerLogsTargetLimiter,
	)
	if err != nil {
		return nil, nil, err
	}

	resourceManager := resourcestream.NewManager(logger, deps.telemetry, deps.clusterMeta, deps.invalidator)
	return logHandler, resourceManager, nil
}
