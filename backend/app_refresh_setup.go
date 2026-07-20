package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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

	// Start the per-cluster health heartbeat loop. It operates directly on
	// a.clusterClients, so it must run even if all subsystems fail auth.
	// Teardown is automatic via a.refreshCancel().
	go a.startHeartbeatLoop(a.refreshCtx)

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
		a.logger.Warn("No refresh subsystems created (all clusters may have auth failures)", logsources.Refresh)
		// Initialize empty state but don't fail - clusters may recover later.
		a.replaceRefreshSubsystems(nil)
		return nil
	}

	a.startRefreshSubsystems(ctx, subsystems)

	mux, aggregates, err := a.buildRefreshMux(subsystems, clusterOrder)
	if err != nil {
		return err
	}
	a.refreshAggregates.Store(aggregates)
	a.sweepNamespacesReadiness(subsystems)

	if err := a.startRefreshHTTPServer(mux, subsystems); err != nil {
		return err
	}

	// The subsystems above all have live manager starts in flight. Begin settling
	// them to the governor's tiers (visible Foreground, warm set Background, the
	// rest Cold). A Cold assignment keeps its producers live until the server has
	// built the retained namespace/overview baseline. The memory-pressure loop
	// stops when the refresh context is cancelled.
	a.seedGovernorFromOpenClusters()
	go a.startGovernorPressureLoop(ctx)

	return nil
}

// subsystemBuildOutcome is one selection's build result: id is always set once the
// selection resolves; subsystem stays nil when the cluster is listed but not served
// (auth failed at init), matching the serial loop's "in clusterOrder, no subsystem".
type subsystemBuildOutcome struct {
	id        string
	subsystem *system.Subsystem
}

// buildSubsystemsInSelectionOrder runs build for every selection index CONCURRENTLY
// (bounded by limit) and returns the outcomes in SELECTION order, so parallel
// construction cannot reorder clusterOrder. Each outcome is written to its own slice
// slot (no shared writes); any build error cancels the remaining builds and aborts
// the whole build, mirroring the serial loop's first-error contract.
func buildSubsystemsInSelectionOrder(
	ctx context.Context,
	count, limit int,
	build func(ctx context.Context, index int) (subsystemBuildOutcome, error),
) ([]subsystemBuildOutcome, error) {
	outcomes := make([]subsystemBuildOutcome, count)
	indices := make([]int, count)
	for i := range indices {
		indices[i] = i
	}
	err := parallel.ForEach(ctx, indices, limit, func(taskCtx context.Context, index int) error {
		outcome, buildErr := build(taskCtx, index)
		if buildErr != nil {
			return buildErr
		}
		outcomes[index] = outcome
		return nil
	})
	if err != nil {
		return nil, err
	}
	return outcomes, nil
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

	// Subsystem construction (informer wiring, permission preflight, spill restore)
	// is the expensive per-cluster step; build the selections concurrently so N
	// clusters do not pay it serially. Outcomes are assembled in selection order, so
	// clusterOrder is exactly what the serial loop produced. Per-cluster internal
	// ordering (preflight before domain registration) lives inside each build and is
	// untouched by the fan-out.
	outcomes, err := buildSubsystemsInSelectionOrder(
		a.CtxOrBackground(),
		len(selections),
		clusterClientBuildConcurrencyLimit(len(selections)),
		func(_ context.Context, index int) (subsystemBuildOutcome, error) {
			selection := selections[index]
			// Use the canonical ID from clusterClients rather than re-deriving
			// from the selection, which can produce inconsistent IDs when a
			// kubeconfig file contains multiple contexts.
			clusterMeta := a.clusterMetaForSelection(selection)
			if clusterMeta.ID == "" {
				return subsystemBuildOutcome{}, fmt.Errorf("cluster identifier missing for selection %s", selection.String())
			}
			clients := a.clusterClientsForID(clusterMeta.ID)
			if clients == nil {
				// Fallback: try matching by stored meta in clusterClients in case
				// the re-derived ID doesn't match the canonical one.
				clients = a.clusterClientsForSelection(selection)
			}
			if clients != nil {
				// Always use the canonical meta from the stored client.
				clusterMeta = clients.meta
			}
			if clients == nil {
				return subsystemBuildOutcome{}, fmt.Errorf("cluster clients unavailable for %s", clusterMeta.ID)
			}

			// Skip subsystem creation if auth is not valid for this cluster.
			// Check both the explicit flag (set during pre-flight check) and the auth state.
			if clients.authFailedOnInit {
				a.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth failed during initialization", clusterMeta.Name), logsources.Refresh, clusterMeta.ID, clusterMeta.Name)
				// Still part of clusterOrder so the cluster appears in the UI.
				return subsystemBuildOutcome{id: clusterMeta.ID}, nil
			}
			if clients.authManager != nil {
				state, reason := clients.authManager.State()
				a.logger.Info(fmt.Sprintf("Auth state for cluster %s: %s (reason: %s)", clusterMeta.Name, state.String(), reason), logsources.Refresh, clusterMeta.ID, clusterMeta.Name)
				if !clients.authManager.IsValid() {
					a.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth not valid (state=%s)", clusterMeta.Name, state.String()), logsources.Refresh, clusterMeta.ID, clusterMeta.Name)
					// Still part of clusterOrder so the cluster appears in the UI.
					return subsystemBuildOutcome{id: clusterMeta.ID}, nil
				}
			}

			subsystem, err := a.buildRefreshSubsystemForSelection(selection, clients, clusterMeta)
			if err != nil {
				return subsystemBuildOutcome{}, err
			}
			return subsystemBuildOutcome{id: clusterMeta.ID, subsystem: subsystem}, nil
		},
	)
	if err != nil {
		return nil, nil, err
	}
	for _, outcome := range outcomes {
		if outcome.subsystem != nil {
			subsystems[outcome.id] = outcome.subsystem
		}
		clusterOrder = append(clusterOrder, outcome.id)
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
		KubernetesClient:           clients.client,
		MetricsClient:              clients.metricsClient,
		RestConfig:                 clients.restConfig,
		ResyncInterval:             config.RefreshResyncInterval,
		MetricsInterval:            a.resolveMetricsInterval(),
		APIExtensionsClient:        clients.apiextensionsClient,
		GatewayClient:              clients.gatewayClient,
		GatewayInformerFactory:     clients.gatewayInformerFactory,
		GatewayAPIPresence:         clients.gatewayAPIPresence,
		DynamicClient:              clients.dynamicClient,
		ObjectDetailsProvider:      a.objectDetailProvider(),
		Logger:                     a.logger,
		ContainerLogsTargetLimiter: a.sharedContainerLogsTargetLimiter(),
		ClusterID:                  clusterMeta.ID,
		ClusterName:                clusterMeta.Name,
		AllowedNamespaces:          a.allowedNamespacesForCluster(clusterMeta.ID),
		AttentionIgnoreRules:       a.attentionIgnoreRulesForCluster(clusterMeta.ID),
		AttentionIgnoredObjectPruner: func(ref resourcemodel.ResourceRef) {
			if err := a.pruneClusterAttentionIgnoredObject(clusterMeta.ID, ref); err != nil {
				a.logger.Warn(fmt.Sprintf("Could not prune obsolete Attention ignore for cluster %s: %v", clusterMeta.ID, err), logsources.Settings, clusterMeta.ID, clusterMeta.ID)
			}
		},
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

	// Transition to loading now that the subsystem is built and about to
	// start serving data. This is the single place where loading is set,
	// regardless of whether the cluster was opened at startup, via the
	// kubeconfig selector, or after auth recovery.
	a.transitionClusterToLoading(clusterMeta.ID)

	// Watch informer updates to invalidate cached detail/YAML/helm responses.
	a.registerResponseCacheInvalidation(subsystem, clusterMeta.ID)

	// Cluster-Ready self-build rides the namespaces doorbell; wired here so
	// selector-opened and auth-recovery subsystems get it too.
	a.wireNamespacesReadinessObserver(clusterMeta.ID, subsystem)

	// Warm-paint the freshly-built maintained stores from this cluster's last spill BEFORE
	// the manager starts feeding (cross-restart cold-start, Tier 2.5 stage 2). Shared by every
	// build path — initial start, selection update, and auth/governor re-warm. Restored rows
	// may be stale; they are reconciled once the subsystem syncs (the start paths call
	// ReconcileMaintainedStores after Manager.Start returns).
	a.restoreClusterStores(clusterMeta.ID, subsystem.Registry)
	// Restore the ingest stores full + RV-stamped too, so each reflector resumes its watch
	// from the persisted resourceVersion (a delta) instead of a full re-LIST when it starts.
	a.restoreClusterIngestStores(clusterMeta.ID, subsystem.IngestManager)
	return subsystem, nil
}

// startRefreshSubsystems runs the manager loops and permission revalidation for each subsystem.
func (a *App) startRefreshSubsystems(ctx context.Context, subsystems map[string]*system.Subsystem) {
	for clusterID, subsystem := range subsystems {
		manager := subsystem.Manager
		if manager == nil {
			continue
		}
		clusterName := a.clusterNameForID(clusterID)
		registry := subsystem.Registry
		go func(mgr *refresh.Manager, registry *domain.Registry, clusterID, clusterName string) {
			if err := mgr.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
				a.logger.Warn(fmt.Sprintf("refresh manager stopped: %v", err), logsources.Refresh, clusterID, clusterName)
				return
			}
			// Start blocks until the factory-backed informer caches have synced. Reconcile
			// away any row warm-painted from a stale spill whose object was deleted while the
			// app was closed; ingest-fed stores either have no reconcile source or reconcile
			// through their reflector's initial Replace.
			if registry != nil {
				registry.ReconcileMaintainedStores()
			}
		}(manager, registry, clusterID, clusterName)
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

// sharedContainerLogsTargetLimiter lazily creates the process-wide container-logs
// target limiter. containerLogsTargetLimiterMu is a LEAF lock: nothing else may be
// locked or loaded while it is held. The settings paths (loadAppSettings,
// GetAppSettings, UpdateAppPreferences) call back into this accessor — some while
// holding settingsMu — so reading settings here would re-enter settingsMu on the same
// goroutine (self-deadlock), and a settingsMu-inside-limiterMu nesting would invert
// their settingsMu→limiterMu order (cross-goroutine ABBA). The limiter therefore
// starts at the default limit; every settings load/update pushes the configured value
// via SetLimit immediately afterwards.
func (a *App) sharedContainerLogsTargetLimiter() *containerlogsstream.GlobalTargetLimiter {
	if a == nil {
		return nil
	}
	// Guard the lazy init: per-cluster subsystem builds call this concurrently.
	a.containerLogsTargetLimiterMu.Lock()
	defer a.containerLogsTargetLimiterMu.Unlock()
	if a.containerLogsTargetLimiter == nil {
		a.containerLogsTargetLimiter = containerlogsstream.NewGlobalTargetLimiter(defaultObjPanelLogsTargetGlobalLimit)
	}
	return a.containerLogsTargetLimiter
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

	// Use first available subsystem for shared telemetry (aggregate diagnostics).
	var sharedTelemetry *telemetry.Recorder
	for _, id := range clusterOrder {
		if sub := subsystems[id]; sub != nil && sub.Telemetry != nil {
			sharedTelemetry = sub.Telemetry
			break
		}
	}

	// Wrap the base refresh API with aggregate services for multi-cluster domains.
	aggregateService := newAggregateSnapshotService(clusterOrder, subsystems)

	// Wire the lifecycle transition: when a cluster's namespace domain serves
	// data successfully, move it from loading/loading_slow to ready.
	aggregateService.onNamespaceSnapshot = func(clusterID string) {
		if a.clusterLifecycle == nil {
			return
		}
		state := a.clusterLifecycle.GetState(clusterID)
		if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
			a.clusterLifecycle.SetState(clusterID, ClusterStateReady)
		}
	}
	aggregateQueue := newAggregateManualQueue(clusterOrder, subsystems)
	aggregateContainerLogs := newAggregateContainerLogsStreamHandler(subsystems)
	aggregateResources, err := newAggregateResourceStreamHandler(subsystems, a.logger, sharedTelemetry)
	if err != nil {
		return nil, nil, err
	}

	// Diagnostics telemetry must be multi-cluster aware: aggregate every active
	// cluster's recorder (each stamps its own clusterId) instead of reporting one
	// picked cluster's counters. Re-scoped on cluster open/close via Update below.
	aggregateTelemetryHandler := newAggregateTelemetry(clusterOrder, subsystems)
	aggregateMetrics := newAggregateMetricsController(subsystems)

	mux := system.BuildRefreshMux(system.MuxConfig{
		SnapshotService: aggregateService,
		ManualQueue:     aggregateQueue,
		Telemetry:       aggregateTelemetryHandler,
		Metrics:         aggregateMetrics,
		HealthHub:       nil, // Health is per-cluster, not global.
	})
	// withStreamCORS guarantees CORS headers on every stream response,
	// including error responses written before the handlers' own header setup.
	mux.Handle("/api/v2/stream/container-logs", withStreamCORS(aggregateContainerLogs))
	mux.Handle("/api/v2/stream/resources", withStreamCORS(aggregateResources))
	// NOTE: Do NOT mount "/" to any single subsystem's handler.
	// Requests to "/" should return 404, not route to one cluster.

	aggregates := &refreshAggregateHandlers{
		snapshot:      aggregateService,
		manual:        aggregateQueue,
		containerLogs: aggregateContainerLogs,
		resources:     aggregateResources,
		telemetry:     aggregateTelemetryHandler,
		metrics:       aggregateMetrics,
	}
	return mux, aggregates, nil
}

// refreshAggregateHandlers stores aggregate endpoints that need live cluster updates.
type refreshAggregateHandlers struct {
	snapshot      *aggregateSnapshotService
	manual        *aggregateManualQueue
	containerLogs *aggregateContainerLogsStreamHandler
	resources     *aggregateResourceStreamHandler
	telemetry     *aggregateTelemetry
	metrics       *aggregateMetricsController
}

// Update refreshes aggregate endpoint wiring without rebuilding the HTTP server.
func (h *refreshAggregateHandlers) Update(clusterOrder []string, subsystems map[string]*system.Subsystem) error {
	if h == nil {
		return nil
	}
	if h.telemetry != nil {
		// Re-scope diagnostics telemetry to the new active cluster set so a
		// closed cluster's counters stop being reported.
		h.telemetry.Update(clusterOrder, subsystems)
	}
	if h.metrics != nil {
		h.metrics.Update(subsystems)
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
	if h.containerLogs != nil {
		h.containerLogs.Update(subsystems)
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
	a.replaceRefreshSubsystems(subsystems)

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
			a.logger.Warn(fmt.Sprintf("refresh HTTP server stopped: %v", err), logsources.Refresh)
		}
	}()

	return nil
}

// transitionClusterToLoading marks a freshly (re)built cluster as loading —
// EXCEPT when the cluster is already READY. The governor re-warms Cold
// clusters through this same chokepoint on tab switches, and re-warm serving
// is CONTINUOUS (the cooled mmap stores serve until the aggregate re-routes;
// the fresh stores are warm-painted from spill before the manager starts), so
// demoting a ready cluster painted "Starting data services" over data that
// never left the screen. Readiness is re-verified anyway: the rebuilt
// subsystem's namespaces notifier re-arms until its stores resettle, and the
// readiness self-build no-ops on an already-ready cluster.
func (a *App) transitionClusterToLoading(clusterID string) {
	if a == nil || a.clusterLifecycle == nil || clusterID == "" {
		return
	}
	if a.clusterLifecycle.GetState(clusterID) == ClusterStateReady {
		return
	}
	a.clusterLifecycle.SetState(clusterID, ClusterStateLoading)
}

// wireNamespacesReadinessObserver closes the cluster-Ready loop server-side
// for ONE cluster: on each namespaces doorbell, while the cluster is still
// loading, self-build the namespaces snapshot (the exact build the
// loading→ready transition rides). Readiness must never depend on the
// frontend's fetch machinery asking first. This is wired at the per-cluster
// subsystem chokepoint — NOT in a one-shot loop at aggregate construction —
// because the notifier's post-settle doorbell is ONE-SHOT and subsystems
// built later (selector-opened clusters, auth-recovery rebuilds) would drop
// it on an empty observer slot and wedge in loading until visited. The
// aggregate service is resolved at ring time: it is (re)built after
// subsystems exist.
func (a *App) wireNamespacesReadinessObserver(clusterID string, subsystem *system.Subsystem) {
	if a == nil || subsystem == nil || subsystem.NamespacesDoorbell == nil || clusterID == "" {
		return
	}
	subsystem.NamespacesDoorbell.Set(func(_ string, _ string) {
		go a.namespacesReadinessSelfBuild(clusterID)
	})
}

func (a *App) namespacesReadinessSelfBuild(clusterID string) {
	// Atomic load: this runs on doorbell goroutines while setup/teardown
	// (re)assign the aggregates.
	aggregates := a.refreshAggregates.Load()
	if aggregates == nil {
		return
	}
	runNamespacesReadinessSelfBuild(a.clusterLifecycle, aggregates.snapshot, clusterID)
}

// sweepNamespacesReadiness wires the readiness observer on every subsystem
// (idempotent) and fires one self-build attempt per cluster. Called right
// after a.refreshAggregates is (re)assigned: any settle ring that fired while
// aggregates were still nil — or before an observer was attached — is healed
// here instead of being lost (the notifier stops re-arming once settled).
func (a *App) sweepNamespacesReadiness(subsystems map[string]*system.Subsystem) {
	for clusterID, subsystem := range subsystems {
		a.wireNamespacesReadinessObserver(clusterID, subsystem)
		go a.namespacesReadinessSelfBuild(clusterID)
	}
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
