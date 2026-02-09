/*
 * backend/refresh/system/manager.go
 *
 * Refresh manager subsystem for Kubernetes clusters.
 * Coordinates the collection of resource summaries, permission checks, and event streaming.
 */

package system

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/klog/v2"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// PermissionIssue captures domains that could not be registered due to missing permissions or transient errors.
type PermissionIssue struct {
	Domain   string // The domain that encountered a permission issue.
	Resource string // The specific resource that caused the permission issue.
	Err      error  // The error encountered while accessing the resource.
}

// Config contains the dependencies required to initialise the refresh manager.
type Config struct {
	KubernetesClient        kubernetes.Interface                    // Kubernetes client for API interactions.
	MetricsClient           *metricsclient.Clientset                // Metrics client for collecting cluster metrics.
	RestConfig              *rest.Config                            // REST configuration for Kubernetes client.
	ResyncInterval          time.Duration                           // Interval for resyncing informers.
	MetricsInterval         time.Duration                           // Interval for collecting metrics.
	APIExtensionsClient     apiextensionsclientset.Interface        // Client for API extensions.
	DynamicClient           dynamic.Interface                       // Dynamic client for interacting with Kubernetes resources.
	HelmFactory             snapshot.HelmActionFactory              // Factory for creating Helm actions.
	ObjectDetailsProvider   snapshot.ObjectDetailProvider           // Provider for detailed object information.
	Logger                  logstream.Logger                        // Logger for recording refresh operations.
	ObjectCatalogEnabled    func() bool                             // Function to check if the object catalog is enabled.
	ObjectCatalogService    func() *objectcatalog.Service           // Function to get the object catalog service.
	ObjectCatalogNamespaces func() []snapshot.CatalogNamespaceGroup // Function to get the object catalog namespaces.
	ClusterID               string                                  // stable identifier for cluster-scoped keys
	ClusterName             string                                  // display name for cluster in payloads
}

// Subsystem bundles the refresh manager and supporting services.
type Subsystem struct {
	Manager          *refresh.Manager        // Refresh manager for coordinating resource updates.
	Handler          http.Handler            // HTTP handler for serving refresh-related endpoints.
	Telemetry        *telemetry.Recorder     // Telemetry recorder for capturing metrics and events.
	PermissionIssues []PermissionIssue       // List of permission issues encountered during refresh.
	InformerFactory  *informer.Factory       // Factory for creating informers.
	RuntimePerms     *permissions.Checker    // Checker for runtime permissions.
	Registry         *domain.Registry        // Registry for managing domain information.
	SnapshotService  refresh.SnapshotService // Service for managing snapshots.
	ManualQueue      refresh.ManualQueue     // Queue for manual refresh requests.
	EventStream      *eventstream.Manager    // Manager for event streams.
	ResourceStream   *resourcestream.Manager // Manager for resource streams.
	ClusterMeta      snapshot.ClusterMeta    // Metadata about the cluster.
}

// NewSubsystem prepares the refresh manager, HTTP handler, and supporting services.
func NewSubsystem(cfg Config) (*refresh.Manager, http.Handler, *telemetry.Recorder, []PermissionIssue, map[string]bool, *informer.Factory, error) {
	subsystem, err := NewSubsystemWithServices(cfg)
	if err != nil {
		recorder := telemetry.NewRecorder()
		recorder.SetClusterMeta(cfg.ClusterID, cfg.ClusterName)
		return nil, nil, recorder, nil, nil, nil, err
	}
	return subsystem.Manager,
		subsystem.Handler,
		subsystem.Telemetry,
		subsystem.PermissionIssues,
		nil,
		subsystem.InformerFactory,
		nil
}

// NewSubsystemWithServices returns a fully wired refresh subsystem.
func NewSubsystemWithServices(cfg Config) (*Subsystem, error) {
	registry := domain.New()
	runtimePerms := permissions.NewChecker(cfg.KubernetesClient, cfg.ClusterID, 0)
	informerFactory := informer.New(cfg.KubernetesClient, cfg.APIExtensionsClient, cfg.ResyncInterval, runtimePerms)
	var permissionIssues []PermissionIssue

	// appendIssue adds a permission issue to the list if any errors are present.
	appendIssue := func(domainName, resource string, errs ...error) {
		err := errors.Join(errs...)
		if err != nil {
			permissionIssues = append(permissionIssues, PermissionIssue{
				Domain:   domainName,
				Resource: resource,
				Err:      err,
			})
		}
	}

	// logSkip logs a message indicating that registration for a domain is being skipped due to insufficient permissions.
	logSkip := func(domainName, group, resource string) {
		klog.V(2).Infof("Skipping registration for domain %s: insufficient permission to list %s/%s", domainName, group, resource)
	}

	gate := newPermissionGate(registry, informerFactory, appendIssue, logSkip)

	telemetryRecorder := telemetry.NewRecorder()
	telemetryRecorder.SetClusterMeta(cfg.ClusterID, cfg.ClusterName)

	clusterMeta := snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName}

	var (
		metricsPoller   refresh.MetricsPoller
		metricsProvider metrics.Provider
	)

	serverHost := ""
	if cfg.RestConfig != nil {
		serverHost = cfg.RestConfig.Host
	}

	// *** Metrics polling ***

	metricsChecks := []listCheck{
		{group: "metrics.k8s.io", resource: "nodes"},
		{group: "metrics.k8s.io", resource: "pods"},
	}
	metricsResults := gate.runListChecks(metricsChecks)
	metricsErrs := gate.listErrors(metricsResults)
	metricsAllowed := gate.allListAllowed(metricsResults)
	allowedByKey := gate.listAllowedByKey(metricsResults)
	metricsNodesAllowed := allowedByKey["metrics.k8s.io/nodes"]
	metricsPodsAllowed := allowedByKey["metrics.k8s.io/pods"]
	metricsNodesErr := gate.listErrFor(metricsResults, "metrics.k8s.io", "nodes")
	metricsPodsErr := gate.listErrFor(metricsResults, "metrics.k8s.io", "pods")

	// Check if metrics polling is allowed and append any permission issues.
	appendIssue("metrics-poller", "metrics.k8s.io/nodes,pods", metricsErrs...)
	if len(metricsErrs) == 0 && metricsAllowed {
		poller := metrics.NewPoller(cfg.MetricsClient, cfg.RestConfig, cfg.MetricsInterval, telemetryRecorder)
		idleTimeout := cfg.MetricsInterval * 3
		demandPoller := metrics.NewDemandPoller(poller, poller, idleTimeout)
		metricsPoller = demandPoller
		metricsProvider = demandPoller
	} else {
		logSkip("metrics-poller", "metrics.k8s.io", "nodes/pods")

		var disabledReasonUI string
		var disabledLogDetail string

		if metricsNodesErr == nil && metricsPodsErr == nil {
			disabledReasonUI = "Insufficient permissions for Metrics API"
			disabledLogDetail = fmt.Sprintf("metrics polling disabled: access denied for metrics.k8s.io (nodesAllowed=%t podsAllowed=%t)", metricsNodesAllowed, metricsPodsAllowed)
		} else {
			disabledReasonUI = "Metrics API not found (metrics-server)"
			disabledLogDetail = fmt.Sprintf("metrics polling disabled: metrics API discovery failed (nodesErr=%v podsErr=%v)", metricsNodesErr, metricsPodsErr)
		}

		if cfg.Logger != nil && disabledLogDetail != "" {
			cfg.Logger.Warn(disabledLogDetail, "Metrics")
		}

		disabled := metrics.NewDisabledPoller(telemetryRecorder, disabledReasonUI)
		metricsPoller = disabled
		metricsProvider = disabled
	}

	deps := registrationDeps{
		registry:        registry,
		informerFactory: informerFactory,
		metricsProvider: metricsProvider,
		cfg:             cfg,
		gate:            gate,
		serverHost:      serverHost,
	}

	registrations := domainRegistrations(deps)
	preflight := preflightRequests(registrations, []informer.PermissionRequest{
		{Group: "metrics.k8s.io", Resource: "nodes", Verb: "list"},
		{Group: "metrics.k8s.io", Resource: "pods", Verb: "list"},
	})

	// PrimePermissions checks the initial set of permissions required for the subsystem.
	ctx, cancel := context.WithTimeout(context.Background(), config.PermissionPreflightTimeout)
	_ = informerFactory.PrimePermissions(ctx, preflight)
	cancel()

	if err := registerDomains(gate, runtimePerms, registrations); err != nil {
		return nil, err
	}

	snapshotService := snapshot.NewServiceWithPermissions(registry, telemetryRecorder, clusterMeta, runtimePerms)
	queue := refresh.NewInMemoryQueue()

	manager := refresh.NewManager(registry, informerFactory, snapshotService, metricsPoller, queue)

	// Build the core refresh routes once so all server configurations stay consistent.
	mux := BuildRefreshMux(MuxConfig{
		SnapshotService: snapshotService,
		ManualQueue:     queue,
		Telemetry:       telemetryRecorder,
		Metrics:         manager,
		HealthHub:       informerFactory,
	})

	eventManager, resourceManager, err := registerStreamHandlers(mux, streamDeps{
		informerFactory: informerFactory,
		snapshotService: snapshotService,
		metricsProvider: metricsProvider,
		cfg:             cfg,
		telemetry:       telemetryRecorder,
		clusterMeta:     clusterMeta,
	})
	if err != nil {
		return nil, err
	}

	return &Subsystem{
		Manager:          manager,
		Handler:          mux,
		Telemetry:        telemetryRecorder,
		PermissionIssues: permissionIssues,
		InformerFactory:  informerFactory,
		RuntimePerms:     runtimePerms,
		Registry:         registry,
		SnapshotService:  snapshotService,
		ManualQueue:      queue,
		EventStream:      eventManager,
		ResourceStream:   resourceManager,
		ClusterMeta:      clusterMeta,
	}, nil
}

// HealthHandler returns an HTTP handler compatible with /healthz/refresh.
func HealthHandler(hub refresh.InformerHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if hub == nil || !hub.HasSynced(r.Context()) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("informers not yet synced"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}
}
