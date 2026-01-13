package system

import (
	"net/http"

	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// streamDeps bundles dependencies required to wire refresh stream handlers.
type streamDeps struct {
	informerFactory *informer.Factory
	snapshotService *snapshot.Service
	metricsProvider metrics.Provider
	cfg             Config
	telemetry       *telemetry.Recorder
	clusterMeta     snapshot.ClusterMeta
}

// registerStreamHandlers wires stream endpoints and returns stream managers.
func registerStreamHandlers(mux *http.ServeMux, deps streamDeps) (*eventstream.Manager, *resourcestream.Manager, error) {
	logHandler, err := logstream.NewHandler(deps.cfg.KubernetesClient, deps.cfg.Logger, deps.telemetry)
	if err != nil {
		return nil, nil, err
	}
	mux.Handle("/api/v2/stream/logs", logHandler)

	eventManager := eventstream.NewManager(
		deps.informerFactory.SharedInformerFactory().Core().V1().Events(),
		deps.cfg.Logger,
		deps.telemetry,
	)
	eventHandler, err := eventstream.NewHandler(deps.snapshotService, eventManager, deps.cfg.Logger)
	if err != nil {
		return nil, nil, err
	}
	mux.Handle("/api/v2/stream/events", eventHandler)

	resourceManager := resourcestream.NewManager(
		deps.informerFactory,
		deps.metricsProvider,
		deps.cfg.Logger,
		deps.telemetry,
		deps.clusterMeta,
		deps.cfg.DynamicClient,
	)
	resourceHandler, err := resourcestream.NewHandler(resourceManager, deps.cfg.Logger, deps.telemetry, deps.clusterMeta)
	if err != nil {
		return nil, nil, err
	}
	mux.Handle("/api/v2/stream/resources", resourceHandler)

	if deps.cfg.ObjectCatalogService != nil {
		catalogHandler := snapshot.NewCatalogStreamHandler(deps.cfg.ObjectCatalogService, deps.cfg.Logger, deps.telemetry, deps.clusterMeta)
		mux.Handle("/api/v2/stream/catalog", catalogHandler)
	}

	return eventManager, resourceManager, nil
}
