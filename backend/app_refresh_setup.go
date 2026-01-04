package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"k8s.io/client-go/kubernetes"
)

func (a *App) setupRefreshSubsystem(kubeClient kubernetes.Interface, selectionKey string) error {
	if kubeClient == nil {
		return errors.New("kubernetes client is nil")
	}
	if a.Ctx == nil {
		return errors.New("application context not initialised")
	}

	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		selections = nil
	}

	subsystems := make(map[string]*system.Subsystem)
	clusterOrder := make([]string, 0)

	ctx, cancel := context.WithCancel(a.Ctx)
	a.refreshCancel = cancel

	var hostSubsystem *system.Subsystem
	hostClusterID := ""

	if len(selections) == 0 {
		clusterMeta := a.currentClusterMeta()
		if clusterMeta.ID != "" {
			hostClusterID = clusterMeta.ID
		} else if selectionKey != "" {
			hostClusterID = selectionKey
		}

		catalogClusterID := clusterMeta.ID
		if catalogClusterID == "" {
			catalogClusterID = selectionKey
		}

		subsystem, err := a.buildRefreshSubsystem(system.Config{
			KubernetesClient:      kubeClient,
			MetricsClient:         a.metricsClient,
			RestConfig:            a.restConfig,
			ResyncInterval:        config.RefreshResyncInterval,
			MetricsInterval:       config.RefreshMetricsInterval,
			APIExtensionsClient:   a.apiextensionsClient,
			DynamicClient:         a.dynamicClient,
			HelmFactory:           a.helmActionFactory(),
			ObjectDetailsProvider: a.objectDetailProvider(),
			Logger:                a.logger,
			ObjectCatalogService: func() *objectcatalog.Service {
				return a.objectCatalogServiceForCluster(catalogClusterID)
			},
			ObjectCatalogNamespaces: a.catalogNamespaceGroups,
			ObjectCatalogEnabled:    func() bool { return true },
			ClusterID:               clusterMeta.ID,
			ClusterName:             clusterMeta.Name,
		}, selectionKey)
		if err != nil {
			return err
		}
		// Watch informer updates to invalidate cached detail/YAML/helm responses.
		a.registerResponseCacheInvalidation(subsystem, selectionKey)

		if hostClusterID != "" {
			subsystems[hostClusterID] = subsystem
			clusterOrder = append(clusterOrder, hostClusterID)
		}
		hostSubsystem = subsystem
	} else {
		// Align the client pool to the selected cluster set before building managers.
		if err := a.syncClusterClientPool(selections); err != nil {
			return err
		}

		for _, selection := range selections {
			clusterMeta := a.clusterMetaForSelection(selection)
			if clusterMeta.ID == "" {
				return fmt.Errorf("cluster identifier missing for selection %s", selection.String())
			}
			clients := a.clusterClientsForID(clusterMeta.ID)
			if clients == nil {
				return fmt.Errorf("cluster clients unavailable for %s", clusterMeta.ID)
			}

			cfg := system.Config{
				KubernetesClient:      clients.client,
				MetricsClient:         clients.metricsClient,
				RestConfig:            clients.restConfig,
				ResyncInterval:        config.RefreshResyncInterval,
				MetricsInterval:       config.RefreshMetricsInterval,
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

			subsystem, err := a.buildRefreshSubsystem(cfg, clusterMeta.ID)
			if err != nil {
				return err
			}
			// Watch informer updates to invalidate cached detail/YAML/helm responses.
			a.registerResponseCacheInvalidation(subsystem, clusterMeta.ID)

			subsystems[clusterMeta.ID] = subsystem
			clusterOrder = append(clusterOrder, clusterMeta.ID)
			if hostSubsystem == nil {
				hostSubsystem = subsystem
			}
		}
	}

	if hostSubsystem == nil {
		return errors.New("refresh subsystem not initialised")
	}

	for _, subsystem := range subsystems {
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
		subsystem.StartPermissionRevalidation(ctx)
	}

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
	aggregateResources := newAggregateResourceStreamHandler(subsystems)
	mux := http.NewServeMux()
	api.NewServer(
		hostSubsystem.Registry,
		aggregateService,
		aggregateQueue,
		hostSubsystem.Telemetry,
		hostSubsystem.Manager,
	).Register(mux)
	mux.Handle("/api/v2/stream/events", aggregateEvents)
	mux.Handle("/api/v2/stream/logs", aggregateLogs)
	mux.Handle("/api/v2/stream/catalog", aggregateCatalog)
	mux.Handle("/api/v2/stream/resources", aggregateResources)
	mux.Handle("/", hostSubsystem.Handler)

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
// buildRefreshSubsystem constructs a refresh subsystem and stores permission cache state.
func (a *App) buildRefreshSubsystem(cfg system.Config, cacheKey string) (*system.Subsystem, error) {
	subsystem, err := newRefreshSubsystemWithServices(cfg)
	if err != nil {
		return nil, err
	}

	if len(subsystem.PermissionIssues) > 0 {
		a.handlePermissionIssues(subsystem.PermissionIssues)
	}
	return subsystem, nil
}

func (a *App) helmActionFactory() snapshot.HelmActionFactory {
	return a.helmActionFactoryForSelection(kubeconfigSelection{
		Path:    a.selectedKubeconfig,
		Context: a.selectedContext,
	})
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
