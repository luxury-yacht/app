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
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
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
	subsystems, clusterOrder, hostSubsystem, err := a.buildRefreshSubsystems(selections)
	if err != nil {
		return err
	}

	a.startRefreshSubsystems(ctx, subsystems)

	mux, aggregates, err := a.buildRefreshMux(hostSubsystem, subsystems, clusterOrder)
	if err != nil {
		return err
	}
	a.refreshAggregates = aggregates

	return a.startRefreshHTTPServer(mux, hostSubsystem, subsystems)
}

// buildRefreshSubsystems creates refresh subsystems for the active cluster selections.
func (a *App) buildRefreshSubsystems(
	selections []kubeconfigSelection,
) (map[string]*system.Subsystem, []string, *system.Subsystem, error) {
	subsystems := make(map[string]*system.Subsystem)
	clusterOrder := make([]string, 0, len(selections))

	if len(selections) == 0 {
		return nil, nil, nil, errors.New("no kubeconfig selections available")
	}

	// Align the client pool to the selected cluster set before building managers.
	if err := a.syncClusterClientPool(selections); err != nil {
		return nil, nil, nil, err
	}

	// hostSubsystem anchors shared mux/telemetry wiring without implying a primary cluster.
	var hostSubsystem *system.Subsystem
	for _, selection := range selections {
		clusterMeta := a.clusterMetaForSelection(selection)
		if clusterMeta.ID == "" {
			return nil, nil, nil, fmt.Errorf("cluster identifier missing for selection %s", selection.String())
		}
		clients := a.clusterClientsForID(clusterMeta.ID)
		if clients == nil {
			return nil, nil, nil, fmt.Errorf("cluster clients unavailable for %s", clusterMeta.ID)
		}

		// Skip subsystem creation if auth is not valid for this cluster.
		// Check both the explicit flag (set during pre-flight check) and the auth state.
		if clients.authFailedOnInit {
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth failed during initialization", clusterMeta.Name), "Refresh")
			}
			// Still add to clusterOrder so the cluster appears in the UI
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
				// Still add to clusterOrder so the cluster appears in the UI
				clusterOrder = append(clusterOrder, clusterMeta.ID)
				continue
			}
		}

		subsystem, err := a.buildRefreshSubsystemForSelection(selection, clients, clusterMeta)
		if err != nil {
			return nil, nil, nil, err
		}

		subsystems[clusterMeta.ID] = subsystem
		clusterOrder = append(clusterOrder, clusterMeta.ID)
		if hostSubsystem == nil {
			hostSubsystem = subsystem
		}
	}

	if hostSubsystem == nil {
		return nil, nil, nil, errors.New("refresh subsystem not initialised")
	}

	return subsystems, clusterOrder, hostSubsystem, nil
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
func (a *App) buildRefreshMux(
	hostSubsystem *system.Subsystem,
	subsystems map[string]*system.Subsystem,
	clusterOrder []string,
) (*http.ServeMux, *refreshAggregateHandlers, error) {
	// Wrap the base refresh API with aggregate services for multi-cluster domains.
	aggregateService := newAggregateSnapshotService(clusterOrder, subsystems)
	aggregateQueue := newAggregateManualQueue(clusterOrder, subsystems)
	aggregateEvents := newAggregateEventStreamHandler(
		aggregateService,
		collectEventManagers(subsystems),
		collectClusterMeta(subsystems),
		clusterOrder,
		hostSubsystem.Telemetry,
		a.logger,
	)
	aggregateLogs := newAggregateLogStreamHandler(subsystems)
	aggregateCatalog := newAggregateCatalogStreamHandler(subsystems)
	aggregateResources, err := newAggregateResourceStreamHandler(subsystems, a.logger, hostSubsystem.Telemetry)
	if err != nil {
		return nil, nil, err
	}

	mux := system.BuildRefreshMux(system.MuxConfig{
		Registry:        hostSubsystem.Registry,
		SnapshotService: aggregateService,
		ManualQueue:     aggregateQueue,
		Telemetry:       hostSubsystem.Telemetry,
		Metrics:         hostSubsystem.Manager,
		// HealthHub stays nil because hostSubsystem.Handler already serves /healthz/refresh.
		HealthHub: nil,
	})
	mux.Handle("/api/v2/stream/events", aggregateEvents)
	mux.Handle("/api/v2/stream/logs", aggregateLogs)
	mux.Handle("/api/v2/stream/catalog", aggregateCatalog)
	mux.Handle("/api/v2/stream/resources", aggregateResources)
	mux.Handle("/", hostSubsystem.Handler)

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
func (a *App) startRefreshHTTPServer(
	mux *http.ServeMux,
	hostSubsystem *system.Subsystem,
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
	a.refreshManager = hostSubsystem.Manager
	a.refreshHTTPServer = srv
	a.refreshListener = listener
	a.refreshBaseURL = "http://" + listener.Addr().String()
	a.telemetryRecorder = hostSubsystem.Telemetry
	a.refreshServerDone = make(chan struct{})
	a.refreshSubsystems = subsystems
	if hostSubsystem.InformerFactory != nil {
		a.sharedInformerFactory = hostSubsystem.InformerFactory.SharedInformerFactory()
		a.apiExtensionsInformerFactory = hostSubsystem.InformerFactory.APIExtensionsInformerFactory()
	} else {
		a.sharedInformerFactory = nil
		a.apiExtensionsInformerFactory = nil
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
