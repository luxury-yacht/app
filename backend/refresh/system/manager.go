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
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/klog/v2"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// PermissionIssue captures domains that could not be registered due to missing permissions or transient errors.
type PermissionIssue struct {
	Domain   string // The domain that encountered a permission issue.
	Resource string // The specific resource that caused the permission issue.
	Err      error  // The error encountered while accessing the resource.
}

// Config contains the dependencies required to initialise the refresh manager.
type Config struct {
	KubernetesClient             kubernetes.Interface                     // Kubernetes client for API interactions.
	MetricsClient                *metricsclient.Clientset                 // Metrics client for collecting cluster metrics.
	RestConfig                   *rest.Config                             // REST configuration for Kubernetes client.
	ResyncInterval               time.Duration                            // Interval for resyncing informers.
	MetricsInterval              time.Duration                            // Interval for collecting metrics.
	APIExtensionsClient          apiextensionsclientset.Interface         // Client for API extensions.
	GatewayClient                gatewayversioned.Interface               // Gateway API client for direct Gateway API resource access.
	GatewayInformerFactory       gatewayinformers.SharedInformerFactory   // Informers for Gateway API resources.
	GatewayAPIPresence           common.GatewayAPIPresence                // Installed Gateway API kind set.
	DynamicClient                dynamic.Interface                        // Dynamic client for interacting with Kubernetes resources.
	ObjectDetailsProvider        snapshot.ObjectDetailProvider            // Provider for detailed object information.
	Logger                       containerlogsstream.Logger               // Logger for recording refresh operations.
	ObjectCatalogEnabled         func() bool                              // Function to check if the object catalog is enabled.
	ObjectCatalogService         func() *objectcatalog.Service            // Function to get the object catalog service.
	ObjectCatalogNamespaces      func() []snapshot.CatalogNamespaceGroup  // Function to get the object catalog namespaces.
	ContainerLogsTargetLimiter   *containerlogsstream.GlobalTargetLimiter // Shared global limiter for container logs stream targets.
	ClusterID                    string                                   // stable identifier for cluster-scoped keys
	ClusterName                  string                                   // display name for cluster in payloads
	AttentionIgnoreRules         snapshot.AttentionIgnoreRules
	AttentionIgnoredObjectPruner func(resourcemodel.ResourceRef)
	// AllowedNamespaces is the cluster's namespace scope
	// (docs/plans/namespace-scope.md). Empty means cluster-wide. Enforced by
	// the permission checker's scope fan-out, the scoped namespaces domain,
	// and the ingest manager's per-namespace reflectors.
	AllowedNamespaces []string
}

// Subsystem bundles the refresh manager and supporting services.
type Subsystem struct {
	Manager          *refresh.Manager        // Refresh manager for coordinating resource updates.
	Handler          http.Handler            // HTTP handler for serving refresh-related endpoints.
	Telemetry        *telemetry.Recorder     // Telemetry recorder for capturing metrics and events.
	PermissionIssues []PermissionIssue       // List of permission issues encountered during refresh.
	InformerFactory  *informer.Factory       // Factory for creating informers.
	IngestManager    *ingest.IngestManager   // Owned-reflector ingestion manager for cut kinds.
	RuntimePerms     *permissions.Checker    // Checker for runtime permissions.
	Registry         *domain.Registry        // Registry for managing domain information.
	SnapshotService  refresh.SnapshotService // Service for managing snapshots.
	ManualQueue      refresh.ManualQueue     // Queue for manual refresh requests.
	EventStream      *eventstream.Manager    // Manager for event streams.
	ResourceStream   *resourcestream.Manager // Manager for resource streams.
	ClusterMeta      snapshot.ClusterMeta    // Metadata about the cluster.
	// NamespaceNotifier and ObjectEventsNotifier drive the namespaces and
	// object-events doorbells. Teardown/cooling MUST Stop() them (via
	// StopDoorbellNotifiers) or their debounce/rearm timers keep broadcasting
	// into the torn-down stream manager.
	NamespaceNotifier    *snapshot.NamespaceChangeNotifier
	ObjectEventsNotifier *snapshot.ObjectEventsChangeNotifier
	AttentionIndex       *snapshot.ClusterAttentionIndex
	// NamespacesDoorbell is the post-broadcast observer slot on the namespaces
	// doorbell; the app attaches the cluster-Ready self-build hook here (see
	// app_refresh_setup) once the aggregate service exists.
	NamespacesDoorbell *NamespacesDoorbellObserver

	// Cooled marks a subsystem in the governor's Cold-tier SERVING state: its informers,
	// metrics poller, and permission revalidation are stopped (heap reclaimed) and its
	// maintained stores have been swapped to off-heap mmap-backed columns, but it stays
	// registered and serves Build queries from those stores (its SnapshotService runs a
	// cooled, always-settled informer hub). A cooled subsystem is non-nil but NOT live:
	// the governor re-warm path detects this and rebuilds a fresh, live subsystem.
	Cooled bool
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

// scopedResourcePredicate reports which resources' permission checks fan out
// over a configured namespace scope (docs/plans/namespace-scope.md): exactly
// the namespaced, ingest-owned kinds, because only their data path runs
// per-namespace. A check's scope must match its data source's scope — scoping
// the check for a cluster-wide source (events, HPA, replicasets, gateway,
// helm storage) would register domains that then serve silently-empty data.
func scopedResourcePredicate() func(group, resource string) bool {
	scoped := make(map[string]struct{})
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		if d.Identity.Namespaced {
			scoped[d.Identity.Group+"/"+d.Identity.Resource] = struct{}{}
		}
	}
	return func(group, resource string) bool {
		_, ok := scoped[group+"/"+resource]
		return ok
	}
}

// NewSubsystemWithServices returns a fully wired refresh subsystem.
func NewSubsystemWithServices(cfg Config) (*Subsystem, error) {
	registry := domain.New()
	runtimePerms := permissions.NewChecker(cfg.KubernetesClient, cfg.ClusterID, 0)
	if len(cfg.AllowedNamespaces) > 0 {
		runtimePerms.SetScope(cfg.AllowedNamespaces, scopedResourcePredicate())
	}
	// Decide once per process whether WatchList is usable, BEFORE the first
	// informer factory issues a watch (client-go reads the WatchListClient gate
	// lazily and caches it). If a bookmark-stripping proxy is in front of the
	// apiserver this disables WatchList so informers fall back to LIST+WATCH
	// instead of wedging. Idempotent — only the first cluster build runs the probe.
	informer.EnsureWatchListDecision(context.Background(), cfg.KubernetesClient)
	informerFactory := informer.New(cfg.KubernetesClient, cfg.APIExtensionsClient, cfg.ResyncInterval, runtimePerms).
		WithGatewayFactory(cfg.GatewayInformerFactory, cfg.GatewayAPIPresence)

	// Owned-reflector ingestion for cut kinds: build the manager, register each cut
	// kind's table/catalog/object-map projectors, and let the composite hub start +
	// sync-gate it alongside the factory. The factory no longer registers the cut
	// kinds' informers (see informer.New), so the ingest manager is their sole source.
	ingestManager := ingest.NewIngestManager(
		streamrows.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName},
		cfg.KubernetesClient,
		cfg.APIExtensionsClient,
		cfg.GatewayClient,
		cfg.AllowedNamespaces...,
	)
	// Dynamic client for the on-demand dynamic (CRD-backed) reflectors the catalog promotes
	// at runtime (objectcatalog maybePromote → RegisterDynamicCatalogReflector). Set before
	// Start; nil leaves the on-demand path disabled and the catalog keeps listing CRs.
	ingestManager.SetDynamicClient(cfg.DynamicClient)
	registerIngestProjectors(ingestManager, cfg.ClusterID, cfg.ClusterName)
	// Pods has no Stream descriptor (its table is the bespoke PodSummary), so the
	// generic ingest loop above does not build it. Wire the pod reflector explicitly
	// with its four-half projector, resolving the ReplicaSet->Deployment owner from
	// the shared factory's RS lister — the RS informer stays registered (only pods is
	// cut). Registered BEFORE the hub starts so the pod reflector launches with the
	// rest and the initial relist is sync-gated.
	jobControllerOwners := snapshot.NewJobControllerOwnerIndex()
	registerPodReflector(
		ingestManager,
		informerFactory,
		snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName},
		jobControllerOwners.Lookup,
	)
	// The five workload kinds (Deployment/StatefulSet/DaemonSet/Job/CronJob) have no Stream
	// descriptor either (their table is the bespoke cross-kind WorkloadSummary), so they too
	// are wired with explicit bespoke projectors. ReplicaSet stays on its typed informer.
	if err := registerWorkloadReflectors(ingestManager, snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName}); err != nil {
		return nil, err
	}
	if !ingestManager.AddBundleSink(snapshot.JobGVR, jobControllerOwners) {
		return nil, fmt.Errorf("register Job owner sink: Job ingest store is unavailable")
	}
	// Service and EndpointSlice have no Stream descriptor either (a Service row is the bespoke
	// Service↔EndpointSlice join), so they are wired with explicit bespoke projectors. Ingress
	// and NetworkPolicy ARE Stream-backed and handled by the generic loop above.
	registerNetworkReflectors(ingestManager, snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName})
	// Node has no Stream descriptor either (its table is the bespoke NodeSummary whose row
	// joins per-node pod aggregates + metrics), so it is wired with an explicit bespoke
	// projector. The nodes domain re-joins pod aggregates + metrics at serve.
	registerNodeReflector(ingestManager, snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName})

	// Permission-gate the ingest reflectors the way the shared factory gates its
	// informers: a cut kind the identity cannot list+watch is skipped at Start rather
	// than launching a reflector that only 403-retries and waits out the sync deadline.
	// CONSERVATIVE: skip ONLY on a confirmed denial (allowed==false, no error). On an
	// SSAR error, run the reflector anyway — the per-kind sync-deadline degrade backstops
	// a true failure, so a transient permission blip never wrongly excludes a kind with
	// no retry. Permission preflight below primes the same checker before Start, and
	// cache misses still run the normal SubjectAccessReview path.
	ingestManager.SetPermissionFilter(ingestPermissionFilter(runtimePerms))

	informerHub := newIngestInformerHub(informerFactory, ingestManager)

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
		poller.SetAllowedNamespaces(cfg.AllowedNamespaces)
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

		if disabledLogDetail != "" {
			applog.Warn(cfg.Logger, disabledLogDetail, "Metrics")
		}

		disabled := metrics.NewDisabledPoller(telemetryRecorder, disabledReasonUI)
		metricsPoller = disabled
		metricsProvider = disabled
	}

	var namespaceNotifier *snapshot.NamespaceChangeNotifier
	var objectEventsNotifier *snapshot.ObjectEventsChangeNotifier
	var attentionIndex *snapshot.ClusterAttentionIndex
	deps := registrationDeps{
		registry:        registry,
		informerFactory: informerFactory,
		ingestManager:   ingestManager,
		metricsProvider: metricsProvider,
		cfg:             cfg,
		gate:            gate,
		serverHost:      serverHost,
		noteNamespaceNotifier: func(notifier *snapshot.NamespaceChangeNotifier) {
			namespaceNotifier = notifier
		},
		noteObjectEventsNotifier: func(notifier *snapshot.ObjectEventsChangeNotifier) {
			objectEventsNotifier = notifier
		},
		noteAttentionIndex: func(index *snapshot.ClusterAttentionIndex) {
			attentionIndex = index
		},
	}

	registrations := domainRegistrations(deps)
	preflight := preflightRequests(registrations, []informer.PermissionRequest{
		{Group: "metrics.k8s.io", Resource: "nodes", Verb: "list"},
		{Group: "metrics.k8s.io", Resource: "pods", Verb: "list"},
	})

	// PrimePermissions checks the initial set of permissions required for the subsystem.
	ctx, cancel := context.WithTimeout(context.Background(), config.PermissionPreflightTimeout)
	defer cancel()
	_ = informerFactory.PrimePermissions(ctx, preflight)

	// Registration reuses the preflight deadline; runtime checks should hit the
	// just-primed permission cache instead of extending startup indefinitely.
	if err := registerDomains(ctx, gate, runtimePerms, registrations); err != nil {
		return nil, err
	}

	snapshotService := snapshot.NewServiceWithPermissions(
		registry,
		telemetryRecorder,
		clusterMeta,
		runtimePerms,
	).WithInformerHub(informerHub).
		WithDomainReadiness(domainReadinessResources(registrations))
	queue := refresh.NewInMemoryQueue()

	manager := refresh.NewManager(registry, informerHub, snapshotService, metricsPoller, queue)

	// Build the core refresh routes once so all server configurations stay consistent.
	mux := BuildRefreshMux(MuxConfig{
		SnapshotService: snapshotService,
		ManualQueue:     queue,
		Telemetry:       telemetryRecorder,
		Metrics: singleClusterMetricsDemandController{
			clusterID: clusterMeta.ClusterID,
			manager:   manager,
		},
		HealthHub: informerHub,
	})

	eventManager, resourceManager, err := registerStreamHandlers(mux, streamDeps{
		informerFactory: informerFactory,
		ingestManager:   ingestManager,
		snapshotService: snapshotService,
		metricsProvider: metricsProvider,
		cfg:             cfg,
		telemetry:       telemetryRecorder,
		clusterMeta:     clusterMeta,
	})
	if err != nil {
		return nil, err
	}
	if resourceManager != nil {
		resourceManager.SetSnapshotDomainInvalidator(snapshotService.InvalidateDomainCache)
	}
	if eventManager != nil && resourceManager != nil {
		eventManager.SetSignalObserver(eventSignalObserver(resourceManager))
	}
	// Metric doorbell: each successful poller collection notifies the stream so
	// the frontend refetches metric-bearing tables on the poller's schedule —
	// no client-side metric polling. Wired via type assertion because the
	// poller may be the disabled stub, which has no observer.
	if resourceManager != nil {
		if observable, ok := metricsPoller.(interface {
			SetCollectionObserver(func(metrics.Metadata))
		}); ok {
			observable.SetCollectionObserver(metricsSignalObserver(resourceManager))
		}
	}
	// Namespaces doorbell: namespace object changes and workload-presence flips
	// broadcast to the namespaces domain's subscribers, replacing the sidebar's
	// 2s poll (the poll remains only as the stream-down fallback). The observer
	// slot lets the app attach the cluster-Ready self-build hook post-construction.
	namespacesDoorbellObserver := &NamespacesDoorbellObserver{}
	if resourceManager != nil && namespaceNotifier != nil {
		wireNamespacesDoorbell(namespaceNotifier, resourceManager, namespacesDoorbellObserver)
	}
	// Object-events doorbell: an event for a panel's object broadcasts to that
	// object's subscribed events scope, replacing the Events tab's 10s poll
	// (the poll remains only as the stream-down fallback).
	if resourceManager != nil && objectEventsNotifier != nil {
		wireObjectEventsDoorbell(objectEventsNotifier, resourceManager)
	}
	if resourceManager != nil && attentionIndex != nil {
		wireClusterAttentionDoorbell(attentionIndex, resourceManager)
	}

	return &Subsystem{
		Manager:              manager,
		Handler:              mux,
		Telemetry:            telemetryRecorder,
		PermissionIssues:     permissionIssues,
		InformerFactory:      informerFactory,
		IngestManager:        ingestManager,
		RuntimePerms:         runtimePerms,
		Registry:             registry,
		SnapshotService:      snapshotService,
		ManualQueue:          queue,
		EventStream:          eventManager,
		ResourceStream:       resourceManager,
		ClusterMeta:          clusterMeta,
		NamespaceNotifier:    namespaceNotifier,
		ObjectEventsNotifier: objectEventsNotifier,
		AttentionIndex:       attentionIndex,
		NamespacesDoorbell:   namespacesDoorbellObserver,
	}, nil
}

// StopDoorbellNotifiers silences every doorbell notifier (namespaces,
// object-events, cluster-attention); nil-safe for subsystems built without them (tests, failed
// registration). Every teardown/cool path must call this or the notifiers'
// debounce/rearm timers keep broadcasting into the dead stream manager.
func (s *Subsystem) StopDoorbellNotifiers() {
	if s == nil {
		return
	}
	if s.NamespaceNotifier != nil {
		s.NamespaceNotifier.Stop()
	}
	if s.ObjectEventsNotifier != nil {
		s.ObjectEventsNotifier.Stop()
	}
	if s.AttentionIndex != nil {
		s.AttentionIndex.Stop()
	}
}

// metricsSignalObserver sends every completed attempt to the namespace health
// notifier, while only successful samples ring the shared SourceMetric
// doorbell. This preserves polling for poll-augmented domains while allowing a
// first failure to move Namespaces out of loading. An empty revision means no
// attempt has completed yet.
// Resource-stream Manager.broadcast owns the ordering contract every doorbell
// must honor: invalidate the domain's snapshot cache first, then deliver the
// signal. The doorbell-triggered
// refetch arrives ~500ms after the change — inside the snapshot cache TTL —
// and served from cache it would apply the PRE-change snapshot permanently,
// because doorbells fire once per change and polling skips while the stream
// is healthy (observed live: created namespaces missing, deleted namespaces
// lingering, while every doorbell log line was perfect). The doorbell tests
// wire through these same helpers so the contract is pinned, not copied.
// NamespacesDoorbellObserver lets the app attach a post-broadcast hook to the
// namespaces doorbell AFTER the subsystem is constructed — the aggregate
// snapshot service and cluster lifecycle (which the hook needs) exist only
// once every subsystem does. The doorbell path reads it lock-free; unset is
// a no-op.
type NamespacesDoorbellObserver struct {
	fn atomic.Pointer[func(version, reason string)]
}

// Set installs (or replaces) the hook.
func (o *NamespacesDoorbellObserver) Set(fn func(version, reason string)) {
	o.fn.Store(&fn)
}

// Invoke fires the hook if one is set; nil-safe. Exported so the doorbell
// closure and app-level tests share one entry point.
func (o *NamespacesDoorbellObserver) Invoke(version, reason string) {
	if o == nil {
		return
	}
	if fn := o.fn.Load(); fn != nil {
		(*fn)(version, reason)
	}
}

func wireNamespacesDoorbell(
	notifier *snapshot.NamespaceChangeNotifier,
	resourceManager *resourcestream.Manager,
	observer *NamespacesDoorbellObserver,
) {
	notifier.SetBroadcast(func(version, reason string) {
		resourceManager.BroadcastNamespacesRefresh(version, reason)
		// After invalidate+broadcast: a self-build triggered here always sees
		// post-change data (the cluster-Ready hook rides this).
		observer.Invoke(version, reason)
	})
}

func wireObjectEventsDoorbell(
	notifier *snapshot.ObjectEventsChangeNotifier,
	resourceManager *resourcestream.Manager,
) {
	notifier.SetBroadcast(func(version string, matches func(scope string) bool) {
		resourceManager.BroadcastObjectEventsRefresh(version, matches)
	})
}

type attentionDoorbellNotifier interface {
	SetBroadcast(func(version string))
}

func wireClusterAttentionDoorbell(
	notifier attentionDoorbellNotifier,
	resourceManager *resourcestream.Manager,
) {
	notifier.SetBroadcast(func(version string) {
		resourceManager.BroadcastClusterAttentionRefresh(version)
	})
}

func metricsSignalObserver(resourceManager *resourcestream.Manager) func(metrics.Metadata) {
	return func(metadata metrics.Metadata) {
		revision := metrics.Revision(metadata)
		if revision == "" || resourceManager == nil {
			return
		}
		if metadata.CollectedAt.IsZero() || metadata.ConsecutiveFailures > 0 || metadata.LastError != "" {
			resourceManager.BroadcastNamespaceMetricsRefresh(revision)
			return
		}
		resourceManager.BroadcastMetricsRefresh(revision)
	}
}

func eventSignalObserver(resourceManager *resourcestream.Manager) func(scope string, sequence uint64) {
	return func(scope string, sequence uint64) {
		if resourceManager == nil || sequence == 0 {
			return
		}
		domain := "cluster-events"
		targetScope := ""
		trimmed := strings.TrimSpace(scope)
		if strings.HasPrefix(trimmed, "namespace:") {
			domain = "namespace-events"
			targetScope = trimmed
		} else if trimmed != "" && trimmed != "cluster" {
			return
		}
		resourceManager.BroadcastEventRefresh(domain, targetScope, strconv.FormatUint(sequence, 10))
	}
}

// ingestPermissionFilter builds the predicate the ingest manager uses to decide whether
// to launch each cut kind's reflector. It mirrors the shared factory's permission-skip
// but conservatively: it skips a kind ONLY on a confirmed denial (allowed==false with no
// error). On an SSAR error it returns true so the reflector still runs — the per-kind
// sync-deadline degrade is the backstop, so a transient permission blip never wrongly
// excludes a kind with no retry. canList/canWatch are the factory's CanListResource/
// CanWatchResource.
func ingestPermissionFilter(checker *permissions.Checker) func(group, resource, namespace string) bool {
	return func(group, resource, namespace string) bool {
		ctx := context.Background()
		// namespace "" is the cluster-wide part — exactly the pre-scope check.
		// A scoped part asks about ITS namespace only, so one denied namespace
		// skips one reflector, never the kind's siblings.
		if decision, err := checker.CanInNamespace(ctx, group, resource, "list", namespace); err == nil && !decision.Allowed {
			return false
		}
		if decision, err := checker.CanInNamespace(ctx, group, resource, "watch", namespace); err == nil && !decision.Allowed {
			return false
		}
		return true
	}
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
