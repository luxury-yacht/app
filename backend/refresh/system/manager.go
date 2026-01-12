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

	// PrimePermissions checks the initial set of permissions required for the subsystem.
	ctx, cancel := context.WithTimeout(context.Background(), config.PermissionPreflightTimeout)
	_ = informerFactory.PrimePermissions(ctx, preflight)
	cancel()
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

	// listCheck models a list-only permission check for a single resource.
	type listCheck struct {
		group    string
		resource string
	}

	// listWatchCheck models a list+watch permission check for a single resource.
	type listWatchCheck struct {
		group    string
		resource string
	}

	// listCheckResult captures the result of a list-only permission check.
	type listCheckResult struct {
		check   listCheck
		allowed bool
		err     error
	}

	// listWatchCheckResult captures the result of a list+watch permission check.
	type listWatchCheckResult struct {
		check        listWatchCheck
		listAllowed  bool
		watchAllowed bool
		err          error
	}

	// runListChecks evaluates list permissions for each requested resource.
	runListChecks := func(checks []listCheck) []listCheckResult {
		results := make([]listCheckResult, 0, len(checks))
		for _, check := range checks {
			allowed, err := informerFactory.CanListResource(check.group, check.resource)
			results = append(results, listCheckResult{
				check:   check,
				allowed: allowed,
				err:     err,
			})
		}
		return results
	}

	// runListWatchChecks evaluates list/watch permissions for each requested resource.
	runListWatchChecks := func(checks []listWatchCheck) []listWatchCheckResult {
		results := make([]listWatchCheckResult, 0, len(checks))
		for _, check := range checks {
			listAllowed, listErr := informerFactory.CanListResource(check.group, check.resource)
			watchAllowed, watchErr := informerFactory.CanWatchResource(check.group, check.resource)
			results = append(results, listWatchCheckResult{
				check:        check,
				listAllowed:  listAllowed,
				watchAllowed: watchAllowed,
				err:          errors.Join(listErr, watchErr),
			})
		}
		return results
	}

	// listErrors extracts non-nil errors from list-only checks.
	listErrors := func(results []listCheckResult) []error {
		errs := make([]error, 0, len(results))
		for _, result := range results {
			if result.err != nil {
				errs = append(errs, result.err)
			}
		}
		return errs
	}

	// listWatchErrors extracts non-nil errors from list/watch checks.
	listWatchErrors := func(results []listWatchCheckResult) []error {
		errs := make([]error, 0, len(results))
		for _, result := range results {
			if result.err != nil {
				errs = append(errs, result.err)
			}
		}
		return errs
	}

	// listWatchErrFor returns the list/watch error for a specific resource, if present.
	listWatchErrFor := func(results []listWatchCheckResult, group, resource string) error {
		for _, result := range results {
			if result.check.group == group && result.check.resource == resource {
				return result.err
			}
		}
		return nil
	}

	// allListAllowed reports whether every list-only check succeeded.
	allListAllowed := func(results []listCheckResult) bool {
		for _, result := range results {
			if !result.allowed {
				return false
			}
		}
		return true
	}

	// anyListAllowed reports whether any list-only check succeeded.
	anyListAllowed := func(results []listCheckResult) bool {
		for _, result := range results {
			if result.allowed {
				return true
			}
		}
		return false
	}

	// allListWatchAllowed reports whether every list/watch check succeeded.
	allListWatchAllowed := func(results []listWatchCheckResult) (bool, bool) {
		listOK := true
		watchOK := true
		for _, result := range results {
			if !result.listAllowed {
				listOK = false
			}
			if !result.watchAllowed {
				watchOK = false
			}
		}
		return listOK, watchOK
	}

	// listAllowedByKey builds a lookup map keyed by "group/resource".
	listAllowedByKey := func(results []listCheckResult) map[string]bool {
		allowed := make(map[string]bool, len(results))
		for _, result := range results {
			group := result.check.group
			if group == "" {
				group = "core"
			}
			key := fmt.Sprintf("%s/%s", group, result.check.resource)
			allowed[key] = result.allowed
		}
		return allowed
	}

	// listDomainConfig describes a list-only gated domain registration.
	type listDomainConfig struct {
		name          string
		issueResource string
		logGroup      string
		logResource   string
		checks        []listCheck
		allowAny      bool
		register      func(allowed map[string]bool) error
		deniedReason  string
	}

	// registerListDomain enforces list-only permissions before registering a domain.
	registerListDomain := func(cfg listDomainConfig) error {
		results := runListChecks(cfg.checks)
		errs := listErrors(results)
		appendIssue(cfg.name, cfg.issueResource, errs...)

		allowed := allListAllowed(results)
		if cfg.allowAny {
			allowed = anyListAllowed(results)
		}

		if len(errs) == 0 && allowed {
			return cfg.register(listAllowedByKey(results))
		}

		logSkip(cfg.name, cfg.logGroup, cfg.logResource)
		return snapshot.RegisterPermissionDeniedDomain(registry, cfg.name, cfg.deniedReason)
	}

	// listWatchDomainConfig describes a list/watch gated domain registration with an optional list fallback.
	type listWatchDomainConfig struct {
		name             string
		issueResource    string
		logGroup         string
		logResource      string
		checks           []listWatchCheck
		registerInformer func() error
		fallbackChecks   []listCheck
		registerFallback func() error
		fallbackLog      string
		deniedReason     string
	}

	// registerListWatchDomain enforces list+watch permissions before registering a domain.
	registerListWatchDomain := func(cfg listWatchDomainConfig) error {
		results := runListWatchChecks(cfg.checks)
		errs := listWatchErrors(results)
		appendIssue(cfg.name, cfg.issueResource, errs...)

		listOK, watchOK := allListWatchAllowed(results)
		if len(errs) == 0 && listOK && watchOK {
			return cfg.registerInformer()
		}

		if cfg.registerFallback != nil && len(cfg.fallbackChecks) > 0 {
			fallbackResults := runListChecks(cfg.fallbackChecks)
			fallbackErrs := listErrors(fallbackResults)
			fallbackWatchErr := false
			for _, fallbackCheck := range cfg.fallbackChecks {
				if err := listWatchErrFor(results, fallbackCheck.group, fallbackCheck.resource); err != nil {
					fallbackWatchErr = true
					break
				}
			}
			if len(fallbackErrs) == 0 && !fallbackWatchErr && allListAllowed(fallbackResults) {
				if cfg.fallbackLog != "" {
					klog.V(2).Info(cfg.fallbackLog)
				}
				return cfg.registerFallback()
			}
		}

		logSkip(cfg.name, cfg.logGroup, cfg.logResource)
		return snapshot.RegisterPermissionDeniedDomain(registry, cfg.name, cfg.deniedReason)
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

	// *** Metrics polling ***

	metricsNodesAllowed, metricsNodesErr := informerFactory.CanListResource("metrics.k8s.io", "nodes")
	metricsPodsAllowed, metricsPodsErr := informerFactory.CanListResource("metrics.k8s.io", "pods")

	// Check if metrics polling is allowed and append any permission issues.
	appendIssue("metrics-poller", "metrics.k8s.io/nodes,pods", metricsNodesErr, metricsPodsErr)
	if metricsNodesErr == nil && metricsPodsErr == nil && metricsNodesAllowed && metricsPodsAllowed {
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

	// *** Namespace domains ***

	// Register namespace domain.
	if err := snapshot.RegisterNamespaceDomain(registry, informerFactory.SharedInformerFactory()); err != nil {
		return nil, err
	}

	// *** Cluster Overview domains ***

	// Register Cluster Overview domain.
	if err := registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-overview",
		issueResource: "core/nodes,pods,namespaces",
		logGroup:      "",
		logResource:   "nodes/namespaces",
		checks: []listWatchCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
			{group: "", resource: "namespaces"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterOverviewDomain(
				registry,
				informerFactory.SharedInformerFactory(),
				cfg.KubernetesClient,
				metricsProvider,
				serverHost,
			)
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "namespaces"},
		},
		registerFallback: func() error {
			return snapshot.RegisterClusterOverviewDomainList(registry, cfg.KubernetesClient, metricsProvider, serverHost)
		},
		fallbackLog:  "Registering cluster overview domain using list fallback due to missing informer permissions",
		deniedReason: "cluster overview requires nodes/namespaces",
	}); err != nil {
		return nil, err
	}

	// *** Object Catalog (Browse) domains ***

	// Register object catalog domain.
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

	// *** Cluster-scoped domains ***

	// Register cluster Nodes domain.
	if err := registerListWatchDomain(listWatchDomainConfig{
		name:          "nodes",
		issueResource: "core/nodes,pods",
		logGroup:      "",
		logResource:   "nodes/pods",
		checks: []listWatchCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
		},
		registerInformer: func() error {
			return snapshot.RegisterNodeDomain(registry, informerFactory.SharedInformerFactory(), metricsProvider)
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
		},
		registerFallback: func() error {
			return snapshot.RegisterNodeDomainList(registry, cfg.KubernetesClient, metricsProvider)
		},
		fallbackLog:  "Registering nodes domain using list fallback due to missing informer permissions",
		deniedReason: "core/nodes (and pods)",
	}); err != nil {
		return nil, err
	}

	// Register cluster Config domain.
	if err := registerListDomain(listDomainConfig{
		name:          "cluster-config",
		issueResource: "storage.k8s.io/storageclasses,networking.k8s.io/ingressclasses,admissionregistration.k8s.io/validatingwebhookconfigurations,admissionregistration.k8s.io/mutatingwebhookconfigurations",
		logGroup:      "*",
		logResource:   "storageclasses/ingressclasses/webhooks",
		checks: []listCheck{
			{group: "storage.k8s.io", resource: "storageclasses"},
			{group: "networking.k8s.io", resource: "ingressclasses"},
			{group: "admissionregistration.k8s.io", resource: "validatingwebhookconfigurations"},
			{group: "admissionregistration.k8s.io", resource: "mutatingwebhookconfigurations"},
		},
		allowAny: true,
		register: func(allowed map[string]bool) error {
			return snapshot.RegisterClusterConfigDomain(
				registry,
				informerFactory.SharedInformerFactory(),
				snapshot.ClusterConfigPermissions{
					IncludeStorageClasses:     allowed["storage.k8s.io/storageclasses"],
					IncludeIngressClasses:     allowed["networking.k8s.io/ingressclasses"],
					IncludeValidatingWebhooks: allowed["admissionregistration.k8s.io/validatingwebhookconfigurations"],
					IncludeMutatingWebhooks:   allowed["admissionregistration.k8s.io/mutatingwebhookconfigurations"],
				},
			)
		},
		deniedReason: "cluster configuration resources",
	}); err != nil {
		return nil, err
	}

	// Register cluster CRDs domain.
	if err := registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-crds",
		issueResource: "apiextensions.k8s.io/customresourcedefinitions",
		logGroup:      "apiextensions.k8s.io",
		logResource:   "customresourcedefinitions",
		checks: []listWatchCheck{
			{group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterCRDDomain(
				registry,
				informerFactory.APIExtensionsInformerFactory(),
			)
		},
		deniedReason: "apiextensions.k8s.io/customresourcedefinitions",
	}); err != nil {
		return nil, err
	}

	// Register cluster Custom domain.
	if err := registerListDomain(listDomainConfig{
		name:          "cluster-custom",
		issueResource: "apiextensions.k8s.io/customresourcedefinitions",
		logGroup:      "apiextensions.k8s.io",
		logResource:   "customresourcedefinitions",
		checks: []listCheck{
			{group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterClusterCustomDomain(
				registry,
				informerFactory.APIExtensionsInformerFactory(),
				cfg.DynamicClient,
				cfg.Logger,
			)
		},
		deniedReason: "apiextensions.k8s.io/customresourcedefinitions",
	}); err != nil {
		return nil, err
	}

	// Register cluster Events domain.
	if err := registerListDomain(listDomainConfig{
		name:          "cluster-events",
		issueResource: "core/events",
		logGroup:      "",
		logResource:   "events",
		checks: []listCheck{
			{group: "", resource: "events"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterClusterEventsDomain(registry, informerFactory.SharedInformerFactory())
		},
		deniedReason: "core/events",
	}); err != nil {
		return nil, err
	}

	// Register cluster RBAC domain.
	if err := registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-rbac",
		issueResource: "rbac.authorization.k8s.io/clusterroles,clusterrolebindings",
		logGroup:      "rbac.authorization.k8s.io",
		logResource:   "clusterroles/clusterrolebindings",
		checks: []listWatchCheck{
			{group: "rbac.authorization.k8s.io", resource: "clusterroles"},
			{group: "rbac.authorization.k8s.io", resource: "clusterrolebindings"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterRBACDomain(
				registry,
				informerFactory.SharedInformerFactory(),
			)
		},
		deniedReason: "rbac.authorization.k8s.io",
	}); err != nil {
		return nil, err
	}

	// Register cluster Storage domain.
	if err := registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-storage",
		issueResource: "core/persistentvolumes",
		logGroup:      "",
		logResource:   "persistentvolumes",
		checks: []listWatchCheck{
			{group: "", resource: "persistentvolumes"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterStorageDomain(
				registry,
				informerFactory.SharedInformerFactory(),
			)
		},
		deniedReason: "core/persistentvolumes",
	}); err != nil {
		return nil, err
	}

	// *** Namespaced domains ***

	// Register namespace Workloads domain.
	if err := snapshot.RegisterNamespaceWorkloadsDomain(
		registry,
		informerFactory.SharedInformerFactory(),
		metricsProvider,
		cfg.Logger,
	); err != nil {
		return nil, err
	}

	// Register namespace Autoscaling domain.
	if err := snapshot.RegisterNamespaceAutoscalingDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}

	// Register namespace Config domain.
	if err := snapshot.RegisterNamespaceConfigDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}

	// Register namespace Custom resources domain.
	if cfg.DynamicClient == nil {
		return nil, fmt.Errorf("dynamic client must be provided for namespace custom resources")
	}
	if err := registerListDomain(listDomainConfig{
		name:          "namespace-custom",
		issueResource: "apiextensions.k8s.io/customresourcedefinitions",
		logGroup:      "apiextensions.k8s.io",
		logResource:   "customresourcedefinitions",
		checks: []listCheck{
			{group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterNamespaceCustomDomain(
				registry,
				informerFactory.APIExtensionsInformerFactory(),
				cfg.DynamicClient,
				cfg.Logger,
			)
		},
		deniedReason: "apiextensions.k8s.io/customresourcedefinitions",
	}); err != nil {
		return nil, err
	}

	// Register namespace Events domain.
	if err := snapshot.RegisterNamespaceEventsDomain(registry, informerFactory.SharedInformerFactory()); err != nil {
		return nil, err
	}

	// Register namespace Helm domain.
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

	// Register namespace Network domain.
	if err := snapshot.RegisterNamespaceNetworkDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}

	// Register namespace Quotas domain.
	if err := snapshot.RegisterNamespaceQuotasDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}

	// Register namespace RBAC domain.
	if err := registerListDomain(listDomainConfig{
		name:          "namespace-rbac",
		issueResource: "rbac.authorization.k8s.io/roles,rolebindings",
		logGroup:      "rbac.authorization.k8s.io",
		logResource:   "roles/rolebindings",
		checks: []listCheck{
			{group: "rbac.authorization.k8s.io", resource: "roles"},
			{group: "rbac.authorization.k8s.io", resource: "rolebindings"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterNamespaceRBACDomain(registry, informerFactory.SharedInformerFactory())
		},
		deniedReason: "rbac.authorization.k8s.io/roles",
	}); err != nil {
		return nil, err
	}

	// Register namespace sStorage domain.
	if err := snapshot.RegisterNamespaceStorageDomain(
		registry,
		informerFactory.SharedInformerFactory(),
	); err != nil {
		return nil, err
	}

	// *** Other Domains ***

	// Register pod domain.
	if err := snapshot.RegisterPodDomain(registry, informerFactory.SharedInformerFactory(), metricsProvider); err != nil {
		return nil, err
	}

	// *** Object Panel domains ***

	//	Register OObject Panel - Details domain.
	if err := snapshot.RegisterObjectDetailsDomain(registry, cfg.KubernetesClient, cfg.APIExtensionsClient, cfg.ObjectDetailsProvider); err != nil {
		return nil, err
	}

	// Register Object Panel - YAML domain.
	if yamlProvider, ok := cfg.ObjectDetailsProvider.(snapshot.ObjectYAMLProvider); ok {
		if err := snapshot.RegisterObjectYAMLDdomain(registry, yamlProvider); err != nil {
			return nil, err
		}
	}

	// Register Object Panel - Helm domains.
	if helmProvider, ok := cfg.ObjectDetailsProvider.(snapshot.HelmContentProvider); ok {
		if err := snapshot.RegisterObjectHelmManifestDomain(registry, helmProvider); err != nil {
			return nil, err
		}
		if err := snapshot.RegisterObjectHelmValuesDomain(registry, helmProvider); err != nil {
			return nil, err
		}
	}

	// Register Object Panel - Events domain.
	if err := snapshot.RegisterObjectEventsDomain(registry, cfg.KubernetesClient, informerFactory.SharedInformerFactory()); err != nil {
		return nil, err
	}

	// Register Object Panel - node Maintenance domain.
	if err := snapshot.RegisterNodeMaintenanceDomain(registry); err != nil {
		return nil, err
	}

	snapshotService := snapshot.NewServiceWithPermissions(registry, telemetryRecorder, clusterMeta, runtimePerms)
	queue := refresh.NewInMemoryQueue()

	manager := refresh.NewManager(registry, informerFactory, snapshotService, metricsPoller, queue)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz/refresh", HealthHandler(informerFactory))
	api.NewServer(registry, snapshotService, queue, telemetryRecorder, manager).Register(mux)

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
