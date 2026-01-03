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

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/api"
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
	Domain   string
	Resource string
	Err      error
}

// Config contains the dependencies required to initialise the refresh manager.
type Config struct {
	KubernetesClient        kubernetes.Interface
	MetricsClient           *metricsclient.Clientset
	RestConfig              *rest.Config
	ResyncInterval          time.Duration
	MetricsInterval         time.Duration
	APIExtensionsClient     apiextensionsclientset.Interface
	DynamicClient           dynamic.Interface
	HelmFactory             snapshot.HelmActionFactory
	ObjectDetailsProvider   snapshot.ObjectDetailProvider
	Logger                  logstream.Logger
	ObjectCatalogEnabled    func() bool
	ObjectCatalogService    func() *objectcatalog.Service
	ObjectCatalogNamespaces func() []snapshot.CatalogNamespaceGroup
	ClusterID               string // stable identifier for cluster-scoped keys
	ClusterName             string // display name for cluster in payloads
}

// Subsystem bundles the refresh manager and supporting services.
type Subsystem struct {
	Manager          *refresh.Manager
	Handler          http.Handler
	Telemetry        *telemetry.Recorder
	PermissionIssues []PermissionIssue
	InformerFactory  *informer.Factory
	RuntimePerms     *permissions.Checker
	Registry         *domain.Registry
	SnapshotService  refresh.SnapshotService
	ManualQueue      refresh.ManualQueue
	EventStream      *eventstream.Manager
	ResourceStream   *resourcestream.Manager
	ClusterMeta      snapshot.ClusterMeta
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
	informerFactory := informer.New(cfg.KubernetesClient, cfg.APIExtensionsClient, cfg.ResyncInterval, nil)
	runtimePerms := permissions.NewChecker(cfg.KubernetesClient, cfg.ClusterID, 0)
	informerFactory.ConfigureRuntimePermissions(runtimePerms, cfg.Logger)

	preflight := []informer.PermissionRequest{
		{Group: "metrics.k8s.io", Resource: "nodes", Verb: "list"},
		{Group: "metrics.k8s.io", Resource: "pods", Verb: "list"},
		{Group: "rbac.authorization.k8s.io", Resource: "roles", Verb: "list"},
		{Group: "rbac.authorization.k8s.io", Resource: "rolebindings", Verb: "list"},
		{Group: "rbac.authorization.k8s.io", Resource: "clusterroles", Verb: "list"},
		{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings", Verb: "list"},
		{Group: "storage.k8s.io", Resource: "storageclasses", Verb: "list"},
		{Group: "networking.k8s.io", Resource: "ingressclasses", Verb: "list"},
		{Group: "admissionregistration.k8s.io", Resource: "validatingwebhookconfigurations", Verb: "list"},
		{Group: "admissionregistration.k8s.io", Resource: "mutatingwebhookconfigurations", Verb: "list"},
		{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions", Verb: "list"},
		{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions", Verb: "watch"},
		{Group: "", Resource: "nodes", Verb: "list"},
		{Group: "", Resource: "nodes", Verb: "watch"},
		{Group: "", Resource: "pods", Verb: "list"},
		{Group: "", Resource: "pods", Verb: "watch"},
		{Group: "", Resource: "namespaces", Verb: "list"},
		{Group: "", Resource: "namespaces", Verb: "watch"},
		{Group: "discovery.k8s.io", Resource: "endpointslices", Verb: "list"},
		{Group: "discovery.k8s.io", Resource: "endpointslices", Verb: "watch"},
		{Group: "", Resource: "persistentvolumes", Verb: "list"},
		{Group: "", Resource: "persistentvolumes", Verb: "watch"},
		{Group: "", Resource: "events", Verb: "list"},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	_ = informerFactory.PrimePermissions(ctx, preflight)
	cancel()
	var permissionIssues []PermissionIssue

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

	logSkip := func(domainName, group, resource string) {
		klog.V(2).Infof("Skipping registration for domain %s: insufficient permission to list %s/%s", domainName, group, resource)
	}

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

	metricsNodesAllowed, metricsNodesErr := informerFactory.CanListResource("metrics.k8s.io", "nodes")
	metricsPodsAllowed, metricsPodsErr := informerFactory.CanListResource("metrics.k8s.io", "pods")
	appendIssue("metrics-poller", "metrics.k8s.io/nodes,pods", metricsNodesErr, metricsPodsErr)
	if metricsNodesErr == nil && metricsPodsErr == nil && metricsNodesAllowed && metricsPodsAllowed {
		poller := metrics.NewPoller(cfg.MetricsClient, cfg.RestConfig, cfg.MetricsInterval, telemetryRecorder)
		metricsPoller = poller
		metricsProvider = poller
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

	if err := snapshot.RegisterNamespaceDomain(registry, informerFactory.SharedInformerFactory()); err != nil {
		return nil, err
	}
	if err := snapshot.RegisterNamespaceWorkloadsDomain(
		registry,
		informerFactory.SharedInformerFactory(),
		metricsProvider,
		cfg.Logger,
	); err != nil {
		return nil, err
	}
	if err := snapshot.RegisterNamespaceConfigDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}
	if err := snapshot.RegisterNamespaceNetworkDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}

	nsRolesAllowed, nsRolesErr := informerFactory.CanListResource("rbac.authorization.k8s.io", "roles")
	nsRoleBindingsAllowed, nsRoleBindingsErr := informerFactory.CanListResource("rbac.authorization.k8s.io", "rolebindings")
	appendIssue("namespace-rbac", "rbac.authorization.k8s.io/roles,rolebindings", nsRolesErr, nsRoleBindingsErr)
	if nsRolesErr == nil && nsRoleBindingsErr == nil && nsRolesAllowed && nsRoleBindingsAllowed {
		if err := snapshot.RegisterNamespaceRBACDomain(registry, informerFactory.SharedInformerFactory()); err != nil {
			return nil, err
		}
	} else {
		logSkip("namespace-rbac", "rbac.authorization.k8s.io", "roles/rolebindings")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "namespace-rbac", "rbac.authorization.k8s.io/roles"); err != nil {
			return nil, err
		}
	}

	if err := snapshot.RegisterNamespaceStorageDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}
	if err := snapshot.RegisterNamespaceAutoscalingDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}
	if err := snapshot.RegisterNamespaceQuotasDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}
	if err := snapshot.RegisterNamespaceEventsDomain(registry, informerFactory.SharedInformerFactory()); err != nil {
		return nil, err
	}

	if cfg.DynamicClient == nil {
		return nil, fmt.Errorf("dynamic client must be provided for namespace custom resources")
	}

	customListAllowed, customListErr := informerFactory.CanListResource("apiextensions.k8s.io", "customresourcedefinitions")
	appendIssue("namespace-custom", "apiextensions.k8s.io/customresourcedefinitions", customListErr)
	if customListErr == nil && customListAllowed {
		if err := snapshot.RegisterNamespaceCustomDomain(
			registry,
			informerFactory.APIExtensionsInformerFactory(),
			cfg.DynamicClient,
			cfg.Logger,
		); err != nil {
			return nil, err
		}
	} else {
		logSkip("namespace-custom", "apiextensions.k8s.io", "customresourcedefinitions")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "namespace-custom", "apiextensions.k8s.io/customresourcedefinitions"); err != nil {
			return nil, err
		}
	}

	if cfg.HelmFactory == nil {
		return nil, fmt.Errorf("helm factory must be provided for namespace helm domain")
	}
	if err := snapshot.RegisterNamespaceHelmDomain(
		registry,
		informerFactory.SharedInformerFactory(),
		cfg.HelmFactory,
	); err != nil {
		return nil, err
	}

	checkListWatch := func(group, resource string) (bool, bool, error) {
		listAllowed, listErr := informerFactory.CanListResource(group, resource)
		watchAllowed, watchErr := informerFactory.CanWatchResource(group, resource)
		return listAllowed, watchAllowed, errors.Join(listErr, watchErr)
	}

	nodesListAllowed, nodesWatchAllowed, nodesErr := checkListWatch("", "nodes")
	podsListAllowed, podsWatchAllowed, podsErr := checkListWatch("", "pods")
	appendIssue("nodes", "core/nodes,pods", nodesErr, podsErr)
	switch {
	case nodesErr == nil && podsErr == nil && nodesListAllowed && nodesWatchAllowed && podsListAllowed && podsWatchAllowed:
		if err := snapshot.RegisterNodeDomain(registry, informerFactory.SharedInformerFactory(), metricsProvider); err != nil {
			return nil, err
		}
	case nodesErr == nil && nodesListAllowed:
		klog.V(2).Info("Registering nodes domain using list fallback due to missing informer permissions")
		if err := snapshot.RegisterNodeDomainList(registry, cfg.KubernetesClient, metricsProvider); err != nil {
			return nil, err
		}
	default:
		logSkip("nodes", "", "nodes/pods")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "nodes", "core/nodes (and pods)"); err != nil {
			return nil, err
		}
	}

	if err := snapshot.RegisterPodDomain(registry, informerFactory.SharedInformerFactory(), metricsProvider); err != nil {
		return nil, err
	}

	if err := snapshot.RegisterNodeMaintenanceDomain(registry); err != nil {
		return nil, err
	}

	clusterOverviewNodesList, clusterOverviewNodesWatch, clusterOverviewNodesErr := checkListWatch("", "nodes")
	clusterOverviewPodsList, clusterOverviewPodsWatch, clusterOverviewPodsErr := checkListWatch("", "pods")
	clusterOverviewNamespacesList, clusterOverviewNamespacesWatch, clusterOverviewNamespacesErr := checkListWatch("", "namespaces")
	appendIssue(
		"cluster-overview",
		"core/nodes,pods,namespaces",
		clusterOverviewNodesErr,
		clusterOverviewPodsErr,
		clusterOverviewNamespacesErr,
	)
	switch {
	case clusterOverviewNodesErr == nil && clusterOverviewPodsErr == nil && clusterOverviewNamespacesErr == nil &&
		clusterOverviewNodesList && clusterOverviewNodesWatch &&
		clusterOverviewPodsList && clusterOverviewPodsWatch &&
		clusterOverviewNamespacesList && clusterOverviewNamespacesWatch:
		if err := snapshot.RegisterClusterOverviewDomain(
			registry,
			informerFactory.SharedInformerFactory(),
			cfg.KubernetesClient,
			metricsProvider,
			serverHost,
		); err != nil {
			return nil, err
		}
	case clusterOverviewNodesErr == nil && clusterOverviewNamespacesErr == nil &&
		clusterOverviewNodesList && clusterOverviewNamespacesList:
		klog.V(2).Info("Registering cluster overview domain using list fallback due to missing informer permissions")
		if err := snapshot.RegisterClusterOverviewDomainList(registry, cfg.KubernetesClient, metricsProvider, serverHost); err != nil {
			return nil, err
		}
	default:
		logSkip("cluster-overview", "", "nodes/namespaces")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-overview", "cluster overview requires nodes/namespaces"); err != nil {
			return nil, err
		}
	}

	if err := snapshot.RegisterObjectDetailsDomain(registry, cfg.KubernetesClient, cfg.APIExtensionsClient, cfg.ObjectDetailsProvider); err != nil {
		return nil, err
	}
	if yamlProvider, ok := cfg.ObjectDetailsProvider.(snapshot.ObjectYAMLProvider); ok {
		if err := snapshot.RegisterObjectYAMLDdomain(registry, yamlProvider); err != nil {
			return nil, err
		}
	}
	if helmProvider, ok := cfg.ObjectDetailsProvider.(snapshot.HelmContentProvider); ok {
		if err := snapshot.RegisterObjectHelmManifestDomain(registry, helmProvider); err != nil {
			return nil, err
		}
		if err := snapshot.RegisterObjectHelmValuesDomain(registry, helmProvider); err != nil {
			return nil, err
		}
	}
	if err := snapshot.RegisterObjectEventsDomain(registry, cfg.KubernetesClient, informerFactory.SharedInformerFactory()); err != nil {
		return nil, err
	}

	clusterRolesListAllowed, clusterRolesWatchAllowed, clusterRolesErr := checkListWatch("rbac.authorization.k8s.io", "clusterroles")
	clusterRoleBindingsListAllowed, clusterRoleBindingsWatchAllowed, clusterRoleBindingsErr := checkListWatch("rbac.authorization.k8s.io", "clusterrolebindings")
	appendIssue("cluster-rbac", "rbac.authorization.k8s.io/clusterroles,clusterrolebindings", clusterRolesErr, clusterRoleBindingsErr)
	if clusterRolesErr == nil && clusterRoleBindingsErr == nil &&
		clusterRolesListAllowed && clusterRolesWatchAllowed &&
		clusterRoleBindingsListAllowed && clusterRoleBindingsWatchAllowed {
		if err := snapshot.RegisterClusterRBACDomain(
			registry,
			informerFactory.SharedInformerFactory(),
		); err != nil {
			return nil, err
		}
	} else {
		logSkip("cluster-rbac", "rbac.authorization.k8s.io", "clusterroles/clusterrolebindings")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-rbac", "rbac.authorization.k8s.io"); err != nil {
			return nil, err
		}
	}

	storageListAllowed, storageWatchAllowed, storageErr := checkListWatch("", "persistentvolumes")
	appendIssue("cluster-storage", "core/persistentvolumes", storageErr)
	switch {
	case storageErr == nil && storageListAllowed && storageWatchAllowed:
		if err := snapshot.RegisterClusterStorageDomain(
			registry,
			informerFactory.SharedInformerFactory(),
		); err != nil {
			return nil, err
		}
	default:
		logSkip("cluster-storage", "", "persistentvolumes")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-storage", "core/persistentvolumes"); err != nil {
			return nil, err
		}
	}

	storageClassesAllowed, storageClassesErr := informerFactory.CanListResource("storage.k8s.io", "storageclasses")
	ingressClassesAllowed, ingressClassesErr := informerFactory.CanListResource("networking.k8s.io", "ingressclasses")
	validatingWebhooksAllowed, validatingWebhooksErr := informerFactory.CanListResource("admissionregistration.k8s.io", "validatingwebhookconfigurations")
	mutatingWebhooksAllowed, mutatingWebhooksErr := informerFactory.CanListResource("admissionregistration.k8s.io", "mutatingwebhookconfigurations")
	appendIssue(
		"cluster-config",
		"storage.k8s.io/storageclasses,networking.k8s.io/ingressclasses,admissionregistration.k8s.io/validatingwebhookconfigurations,admissionregistration.k8s.io/mutatingwebhookconfigurations",
		storageClassesErr,
		ingressClassesErr,
		validatingWebhooksErr,
		mutatingWebhooksErr,
	)
	if storageClassesErr == nil && ingressClassesErr == nil && validatingWebhooksErr == nil && mutatingWebhooksErr == nil &&
		(storageClassesAllowed || ingressClassesAllowed || validatingWebhooksAllowed || mutatingWebhooksAllowed) {
		if err := snapshot.RegisterClusterConfigDomain(
			registry,
			informerFactory.SharedInformerFactory(),
			snapshot.ClusterConfigPermissions{
				IncludeStorageClasses:     storageClassesAllowed,
				IncludeIngressClasses:     ingressClassesAllowed,
				IncludeValidatingWebhooks: validatingWebhooksAllowed,
				IncludeMutatingWebhooks:   mutatingWebhooksAllowed,
			},
		); err != nil {
			return nil, err
		}
	} else {
		logSkip("cluster-config", "*", "storageclasses/ingressclasses/webhooks")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-config", "cluster configuration resources"); err != nil {
			return nil, err
		}
	}

	crdListAllowed, crdListErr := informerFactory.CanListResource("apiextensions.k8s.io", "customresourcedefinitions")
	crdWatchAllowed, crdWatchErr := informerFactory.CanWatchResource("apiextensions.k8s.io", "customresourcedefinitions")
	appendIssue("cluster-crds", "apiextensions.k8s.io/customresourcedefinitions", errors.Join(crdListErr, crdWatchErr))
	switch {
	case crdListErr == nil && crdWatchErr == nil && crdListAllowed && crdWatchAllowed:
		if err := snapshot.RegisterClusterCRDDomain(
			registry,
			informerFactory.APIExtensionsInformerFactory(),
		); err != nil {
			return nil, err
		}
	default:
		logSkip("cluster-crds", "apiextensions.k8s.io", "customresourcedefinitions")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-crds", "apiextensions.k8s.io/customresourcedefinitions"); err != nil {
			return nil, err
		}
	}

	clusterCustomAllowed, clusterCustomErr := informerFactory.CanListResource("apiextensions.k8s.io", "customresourcedefinitions")
	appendIssue("cluster-custom", "apiextensions.k8s.io/customresourcedefinitions", clusterCustomErr)
	if clusterCustomErr == nil && clusterCustomAllowed {
		if err := snapshot.RegisterClusterCustomDomain(
			registry,
			informerFactory.APIExtensionsInformerFactory(),
			cfg.DynamicClient,
			cfg.Logger,
		); err != nil {
			return nil, err
		}
	} else {
		logSkip("cluster-custom", "apiextensions.k8s.io", "customresourcedefinitions")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-custom", "apiextensions.k8s.io/customresourcedefinitions"); err != nil {
			return nil, err
		}
	}

	clusterEventsAllowed, clusterEventsErr := informerFactory.CanListResource("", "events")
	appendIssue("cluster-events", "core/events", clusterEventsErr)
	if clusterEventsErr == nil && clusterEventsAllowed {
		if err := snapshot.RegisterClusterEventsDomain(registry, informerFactory.SharedInformerFactory()); err != nil {
			return nil, err
		}
	} else {
		logSkip("cluster-events", "", "events")
		if err := snapshot.RegisterPermissionDeniedDomain(registry, "cluster-events", "core/events"); err != nil {
			return nil, err
		}
	}

	if cfg.ObjectCatalogService != nil {
		if err := snapshot.RegisterCatalogDomain(registry, snapshot.CatalogConfig{
			CatalogService:  cfg.ObjectCatalogService,
			NamespaceGroups: cfg.ObjectCatalogNamespaces,
			Logger:          cfg.Logger,
		}); err != nil {
			return nil, err
		}
		// Use a separate catalog domain for the diff viewer to avoid scope collisions with Browse.
		if err := snapshot.RegisterCatalogDiffDomain(registry, snapshot.CatalogConfig{
			CatalogService:  cfg.ObjectCatalogService,
			NamespaceGroups: cfg.ObjectCatalogNamespaces,
			Logger:          cfg.Logger,
		}); err != nil {
			return nil, err
		}
	}

	snapshotService := snapshot.NewService(registry, telemetryRecorder, clusterMeta)
	queue := refresh.NewInMemoryQueue()

	manager := refresh.NewManager(registry, informerFactory, snapshotService, metricsPoller, queue)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz/refresh", HealthHandler(informerFactory))
	api.NewServer(registry, snapshotService, queue, telemetryRecorder).Register(mux)

	logHandler, err := logstream.NewHandler(cfg.KubernetesClient, cfg.Logger, telemetryRecorder)
	if err != nil {
		return nil, err
	}
	mux.Handle("/api/v2/stream/logs", logHandler)

	eventManager := eventstream.NewManager(
		informerFactory.SharedInformerFactory().Core().V1().Events(),
		cfg.Logger,
		telemetryRecorder,
	)
	eventHandler, err := eventstream.NewHandler(snapshotService, eventManager, cfg.Logger)
	if err != nil {
		return nil, err
	}
	mux.Handle("/api/v2/stream/events", eventHandler)

	resourceManager := resourcestream.NewManager(
		informerFactory,
		metricsProvider,
		cfg.Logger,
		telemetryRecorder,
		clusterMeta,
		cfg.DynamicClient,
	)
	resourceHandler, err := resourcestream.NewHandler(resourceManager, cfg.Logger, telemetryRecorder, clusterMeta)
	if err != nil {
		return nil, err
	}
	mux.Handle("/api/v2/stream/resources", resourceHandler)

	if cfg.ObjectCatalogService != nil {
		catalogHandler := snapshot.NewCatalogStreamHandler(cfg.ObjectCatalogService, cfg.Logger, telemetryRecorder, clusterMeta)
		mux.Handle("/api/v2/stream/catalog", catalogHandler)
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
