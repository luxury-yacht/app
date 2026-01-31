package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

func (a *App) resolveMetricsInterval() time.Duration {
	if a.appSettings != nil && a.appSettings.MetricsRefreshIntervalMs > 0 {
		return time.Duration(a.appSettings.MetricsRefreshIntervalMs) * time.Millisecond
	}
	return config.RefreshMetricsInterval
}

func (a *App) setupRefreshSubsystem() error {
	if a.Ctx == nil {
		return errors.New("application context not initialised")
	}

	ctx, cancel := context.WithCancel(a.Ctx)
	a.refreshCtx = ctx
	a.refreshCancel = cancel

	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		return err
	}
	subsystems, clusterOrder, err := a.buildRefreshSubsystems(selections)
	if err != nil {
		return err
	}

	// Handle case where no subsystems were created (all auth failed).
	if len(subsystems) == 0 {
		a.logger.Warn("No refresh subsystems created (all clusters may have auth failures)", "Refresh")
		// Initialize empty state but don't fail - clusters may recover later.
		a.refreshSubsystems = make(map[string]*system.Subsystem)
		return nil
	}

	a.startRefreshSubsystems(ctx, subsystems)

	mux, aggregates, err := a.buildRefreshMux(subsystems, clusterOrder)
	if err != nil {
		return err
	}
	a.refreshAggregates = aggregates

	return a.startRefreshHTTPServer(mux, subsystems)
}

// buildRefreshSubsystems creates refresh subsystems for the active cluster selections.
// All clusters are treated equally - there is no "primary" or "host" cluster.
func (a *App) buildRefreshSubsystems(
	selections []kubeconfigSelection,
) (map[string]*system.Subsystem, []string, error) {
	subsystems := make(map[string]*system.Subsystem)
	clusterOrder := make([]string, 0, len(selections))

	if len(selections) == 0 {
		return nil, nil, errors.New("no kubeconfig selections available")
	}

	// Align the client pool to the selected cluster set before building managers.
	if err := a.syncClusterClientPool(selections); err != nil {
		return nil, nil, err
	}

	for _, selection := range selections {
		clusterMeta := a.clusterMetaForSelection(selection)
		if clusterMeta.ID == "" {
			return nil, nil, fmt.Errorf("cluster identifier missing for selection %s", selection.String())
		}
		clients := a.clusterClientsForID(clusterMeta.ID)
		if clients == nil {
			return nil, nil, fmt.Errorf("cluster clients unavailable for %s", clusterMeta.ID)
		}

		// Skip subsystem creation if auth is not valid for this cluster.
		// Check both the explicit flag (set during pre-flight check) and the auth state.
		if clients.authFailedOnInit {
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth failed during initialization", clusterMeta.Name), "Refresh")
			}
			// Still add to clusterOrder so the cluster appears in the UI.
			clusterOrder = append(clusterOrder, clusterMeta.ID)
			continue
		}
		if clients.authManager != nil {
			state, reason := clients.authManager.State()
			if a.logger != nil {
				a.logger.Info(fmt.Sprintf("Auth state for cluster %s: %s (reason: %s)", clusterMeta.Name, state.String(), reason), "Refresh")
			}
			if !clients.authManager.IsValid() {
				if a.logger != nil {
					a.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth not valid (state=%s)", clusterMeta.Name, state.String()), "Refresh")
				}
				// Still add to clusterOrder so the cluster appears in the UI.
				clusterOrder = append(clusterOrder, clusterMeta.ID)
				continue
			}
		}

		subsystem, err := a.buildRefreshSubsystemForSelection(selection, clients, clusterMeta)
		if err != nil {
			return nil, nil, err
		}

		subsystems[clusterMeta.ID] = subsystem
		clusterOrder = append(clusterOrder, clusterMeta.ID)
	}

	// Note: It's valid to return an empty subsystems map if all clusters have auth failures.
	// The caller should handle this case gracefully.
	return subsystems, clusterOrder, nil
}

func (a *App) buildRefreshSubsystemForSelection(
	selection kubeconfigSelection,
	clients *clusterClients,
	clusterMeta ClusterMeta,
) (*system.Subsystem, error) {
	cfg := system.Config{
		KubernetesClient:      clients.client,
		MetricsClient:         clients.metricsClient,
		RestConfig:            clients.restConfig,
		ResyncInterval:        config.RefreshResyncInterval,
		MetricsInterval:       a.resolveMetricsInterval(),
		APIExtensionsClient:   clients.apiextensionsClient,
		DynamicClient:         clients.dynamicClient,
		HelmFactory:           a.helmActionFactoryForSelection(selection),
		ObjectDetailsProvider: a.objectDetailProvider(),
		Logger:                a.logger,
		ClusterID:             clusterMeta.ID,
		ClusterName:           clusterMeta.Name,
	}

	cfg.ObjectCatalogService = func() *objectcatalog.Service {
		return a.objectCatalogServiceForCluster(clusterMeta.ID)
	}
	cfg.ObjectCatalogNamespaces = a.catalogNamespaceGroups
	cfg.ObjectCatalogEnabled = func() bool { return true }

	subsystem, err := a.buildRefreshSubsystem(cfg)
	if err != nil {
		return nil, err
	}
	// Watch informer updates to invalidate cached detail/YAML/helm responses.
	a.registerResponseCacheInvalidation(subsystem, clusterMeta.ID)
	return subsystem, nil
}

// startRefreshSubsystems runs the manager loops and permission revalidation for each subsystem.
func (a *App) startRefreshSubsystems(ctx context.Context, subsystems map[string]*system.Subsystem) {
	for clusterID, subsystem := range subsystems {
		manager := subsystem.Manager
		if manager == nil {
			continue
		}
		go func(mgr *refresh.Manager) {
			if err := mgr.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
				a.logger.Warn(fmt.Sprintf("refresh manager stopped: %v", err), "Refresh")
			}
		}(manager)
		// Keep permission grants fresh; revoke access stops refresh informers/streams.
		permCtx, cancel := context.WithCancel(ctx)
		a.storeRefreshPermissionCancel(clusterID, cancel)
		subsystem.StartPermissionRevalidation(permCtx)
	}
}

func (a *App) storeRefreshPermissionCancel(clusterID string, cancel context.CancelFunc) {
	if a == nil || clusterID == "" || cancel == nil {
		return
	}
	if a.refreshPermissionCancels == nil {
		a.refreshPermissionCancels = make(map[string]context.CancelFunc)
	}
	if prev := a.refreshPermissionCancels[clusterID]; prev != nil {
		prev()
	}
	a.refreshPermissionCancels[clusterID] = cancel
}

// buildRefreshMux wires the aggregate refresh routes on top of the core API endpoints.
// All clusters are treated equally - telemetry and registry are taken from
// the first available cluster, but no single cluster is "special".
func (a *App) buildRefreshMux(
	subsystems map[string]*system.Subsystem,
	clusterOrder []string,
) (*http.ServeMux, *refreshAggregateHandlers, error) {
	if len(subsystems) == 0 {
		return nil, nil, errors.New("no subsystems available for mux")
	}

	// Use first available subsystem for shared telemetry and registry.
	// Any cluster works since these are used for aggregate handling.
	var sharedTelemetry *telemetry.Recorder
	var sharedRegistry *domain.Registry
	for _, id := range clusterOrder {
		if sub := subsystems[id]; sub != nil {
			if sharedTelemetry == nil && sub.Telemetry != nil {
				sharedTelemetry = sub.Telemetry
			}
			if sharedRegistry == nil && sub.Registry != nil {
				sharedRegistry = sub.Registry
			}
			if sharedTelemetry != nil && sharedRegistry != nil {
				break
			}
		}
	}

	// Wrap the base refresh API with aggregate services for multi-cluster domains.
	aggregateService := newAggregateSnapshotService(clusterOrder, subsystems)
	aggregateQueue := newAggregateManualQueue(clusterOrder, subsystems)
	aggregateEvents := newAggregateEventStreamHandler(
		aggregateService,
		collectEventManagers(subsystems),
		collectClusterMeta(subsystems),
		clusterOrder,
		sharedTelemetry,
		a.logger,
	)
	aggregateLogs := newAggregateLogStreamHandler(subsystems)
	aggregateCatalog := newAggregateCatalogStreamHandler(subsystems)
	aggregateResources, err := newAggregateResourceStreamHandler(subsystems, a.logger, sharedTelemetry)
	if err != nil {
		return nil, nil, err
	}

	mux := system.BuildRefreshMux(system.MuxConfig{
		Registry:        sharedRegistry,
		SnapshotService: aggregateService,
		ManualQueue:     aggregateQueue,
		Telemetry:       sharedTelemetry,
		Metrics:         nil, // Don't tie metrics to a single cluster.
		HealthHub:       nil, // Health is per-cluster, not global.
	})
	mux.Handle("/api/v2/stream/events", aggregateEvents)
	mux.Handle("/api/v2/stream/logs", aggregateLogs)
	mux.Handle("/api/v2/stream/catalog", aggregateCatalog)
	mux.Handle("/api/v2/stream/resources", aggregateResources)
	// NOTE: Do NOT mount "/" to any single subsystem's handler.
	// Requests to "/" should return 404, not route to one cluster.

	aggregates := &refreshAggregateHandlers{
		snapshot:  aggregateService,
		manual:    aggregateQueue,
		events:    aggregateEvents,
		logs:      aggregateLogs,
		catalog:   aggregateCatalog,
		resources: aggregateResources,
	}
	return mux, aggregates, nil
}

// refreshAggregateHandlers stores aggregate endpoints that need live cluster updates.
type refreshAggregateHandlers struct {
	snapshot  *aggregateSnapshotService
	manual    *aggregateManualQueue
	events    *aggregateEventStreamHandler
	logs      *aggregateLogStreamHandler
	catalog   *aggregateCatalogStreamHandler
	resources *aggregateResourceStreamHandler
}

// Update refreshes aggregate endpoint wiring without rebuilding the HTTP server.
func (h *refreshAggregateHandlers) Update(clusterOrder []string, subsystems map[string]*system.Subsystem) error {
	if h == nil {
		return nil
	}
	if h.resources != nil {
		if err := h.resources.Update(subsystems); err != nil {
			return err
		}
	}
	if h.snapshot != nil {
		h.snapshot.Update(clusterOrder, subsystems)
	}
	if h.manual != nil {
		h.manual.UpdateConfig(clusterOrder, subsystems)
	}
	if h.events != nil {
		h.events.UpdateConfig(
			h.snapshot,
			collectEventManagers(subsystems),
			collectClusterMeta(subsystems),
			clusterOrder,
		)
	}
	if h.logs != nil {
		h.logs.Update(subsystems)
	}
	if h.catalog != nil {
		h.catalog.Update(subsystems)
	}
	return nil
}

// startRefreshHTTPServer starts the loopback HTTP server and records the runtime wiring.
// All clusters are treated equally - no single cluster is primary.
func (a *App) startRefreshHTTPServer(
	mux *http.ServeMux,
	subsystems map[string]*system.Subsystem,
) error {
	if a.listenLoopback == nil {
		a.listenLoopback = defaultLoopbackListener
	}

	listener, err := a.listenLoopback()
	if err != nil {
		return err
	}

	srv := &http.Server{Handler: mux}
	// Don't set refreshManager from a single cluster - it's per-cluster now.
	a.refreshManager = nil
	a.refreshHTTPServer = srv
	a.refreshListener = listener
	a.refreshBaseURL = "http://" + listener.Addr().String()
	a.refreshServerDone = make(chan struct{})
	a.refreshSubsystems = subsystems

	// Use first available subsystem for telemetry (for global telemetry needs).
	a.telemetryRecorder = nil
	for _, sub := range subsystems {
		if sub != nil && sub.Telemetry != nil {
			a.telemetryRecorder = sub.Telemetry
			break
		}
	}

	// Use first available subsystem for informer factories (for discovery).
	a.sharedInformerFactory = nil
	a.apiExtensionsInformerFactory = nil
	for _, sub := range subsystems {
		if sub != nil && sub.InformerFactory != nil {
			a.sharedInformerFactory = sub.InformerFactory.SharedInformerFactory()
			a.apiExtensionsInformerFactory = sub.InformerFactory.APIExtensionsInformerFactory()
			break
		}
	}

	go func() {
		defer close(a.refreshServerDone)
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			a.logger.Warn(fmt.Sprintf("refresh HTTP server stopped: %v", err), "Refresh")
		}
	}()

	return nil
}

// buildRefreshSubsystem constructs a refresh subsystem and stores permission cache state.
func (a *App) buildRefreshSubsystem(cfg system.Config) (*system.Subsystem, error) {
	subsystem, err := newRefreshSubsystemWithServices(cfg)
	if err != nil {
		return nil, err
	}

	if len(subsystem.PermissionIssues) > 0 {
		a.handlePermissionIssues(subsystem.PermissionIssues)
	}
	return subsystem, nil
}

// helmActionFactoryForSelection wires Helm actions to a specific kubeconfig selection.
func (a *App) helmActionFactoryForSelection(selection kubeconfigSelection) snapshot.HelmActionFactory {
	return func(namespace string) (*action.Configuration, error) {
		settings := cli.New()
		if selection.Path != "" {
			settings.KubeConfig = selection.Path
		}
		if selection.Context != "" {
			settings.KubeContext = selection.Context
		}

		actionConfig := new(action.Configuration)
		if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "secret", func(format string, v ...interface{}) {
			if a.logger != nil {
				a.logger.Debug(fmt.Sprintf(format, v...), "Helm")
			}
		}); err != nil {
			return nil, err
		}
		return actionConfig, nil
	}
}
