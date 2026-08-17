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
	"sync"
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
	"github.com/luxury-yacht/app/backend/nodemaintenance"
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

const metricsAPIGroup = "metrics.k8s.io"

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
	ContainerLogsPerScopeLimit   int                                      // Captured per-scope target cap for direct and streaming log selection.
	NodeMaintenanceStore         *nodemaintenance.Store                   // Shared process-owned, cluster-keyed drain state.
	ClusterID                    string                                   // stable identifier for cluster-scoped keys
	ClusterName                  string                                   // display name for cluster in payloads
	AttentionIgnoreRules         snapshot.AttentionIgnoreRules
	AttentionIgnoredObjectPruner func(resourcemodel.ResourceRef)
	// AllowedNamespaces is the cluster's namespace scope
	// (docs/architecture/namespace-scope.md). Empty means cluster-wide. Enforced by
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
	SnapshotService  refresh.SnapshotBuilder // Service for managing snapshots.
	ManualQueue      refresh.ManualQueue     // Queue for manual refresh requests.
	EventStream      *eventstream.Manager    // Manager for event streams.
	ResourceStream   *resourcestream.Manager // Manager for resource streams.
	ContainerLogs    *containerlogsstream.Handler
	ClusterMeta      snapshot.ClusterMeta // Metadata about the cluster.
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

	// coldPreparation is the server-owned gate in front of Cooled. Its context is
	// owned by this subsystem generation so replacement/teardown can stop both an
	// in-flight build and its retry loop.
	coldPreparationMu      sync.Mutex
	coldPreparationState   coldPreparationState
	coldPreparationStarted time.Time
	coldPreparationCancel  context.CancelFunc
}

type coldPreparationState uint8

const (
	coldPreparationNotStarted coldPreparationState = iota
	coldPreparationRunning
	coldPreparationReady
)

// BeginColdPreparation elects one goroutine to prepare the retained snapshots
// required before this subsystem may stop its live producers. The returned
// context is canceled when this subsystem generation stops.
func (s *Subsystem) BeginColdPreparation(parent context.Context, startedAt time.Time) (context.Context, bool) {
	if s == nil || parent == nil {
		return nil, false
	}
	s.coldPreparationMu.Lock()
	defer s.coldPreparationMu.Unlock()
	if s.coldPreparationState != coldPreparationNotStarted {
		return nil, false
	}
	ctx, cancel := context.WithCancel(parent)
	s.coldPreparationState = coldPreparationRunning
	s.coldPreparationStarted = startedAt
	s.coldPreparationCancel = cancel
	return ctx, true
}

// MarkColdServingReady records that the retained baseline has been built from
// settled sources and this subsystem is eligible for the Cold serving tier.
func (s *Subsystem) MarkColdServingReady() {
	if s == nil {
		return
	}
	s.coldPreparationMu.Lock()
	if s.coldPreparationState == coldPreparationRunning {
		s.coldPreparationState = coldPreparationReady
	}
	cancel := s.coldPreparationCancel
	s.coldPreparationCancel = nil
	s.coldPreparationMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// CancelColdPreparation stops work owned by this subsystem generation.
func (s *Subsystem) CancelColdPreparation() {
	if s == nil {
		return
	}
	s.coldPreparationMu.Lock()
	cancel := s.coldPreparationCancel
	s.coldPreparationCancel = nil
	s.coldPreparationState = coldPreparationNotStarted
	s.coldPreparationStarted = time.Time{}
	s.coldPreparationMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// ColdServingReady reports whether the server-owned retained baseline exists.
func (s *Subsystem) ColdServingReady() bool {
	if s == nil {
		return false
	}
	s.coldPreparationMu.Lock()
	defer s.coldPreparationMu.Unlock()
	return s.coldPreparationState == coldPreparationReady
}

// ColdPreparationAge reports how long this generation has been preparing its
// retained baseline. Ready and not-started generations are not pending.
func (s *Subsystem) ColdPreparationAge(now time.Time) (time.Duration, bool) {
	if s == nil {
		return 0, false
	}
	s.coldPreparationMu.Lock()
	defer s.coldPreparationMu.Unlock()
	if s.coldPreparationState != coldPreparationRunning || s.coldPreparationStarted.IsZero() {
		return 0, false
	}
	age := now.Sub(s.coldPreparationStarted)
	if age < 0 {
		age = 0
	}
	return age, true
}

// scopedResourcePredicate reports which resources' permission checks fan out
// over a configured namespace scope (docs/architecture/namespace-scope.md): exactly
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

func newInformerInfrastructure(cfg Config) (*permissions.Checker, *informer.Factory) {
	runtimePerms := permissions.NewChecker(cfg.KubernetesClient, cfg.ClusterID, 0)
	if len(cfg.AllowedNamespaces) > 0 {
		runtimePerms.SetScope(cfg.AllowedNamespaces, scopedResourcePredicate())
	}
	// Decide once per process whether WatchList is usable before the first
	// informer factory issues a watch; client-go reads and caches the gate lazily.
	informer.EnsureWatchListDecision(context.Background(), cfg.KubernetesClient)
	factory := informer.New(cfg.KubernetesClient, cfg.APIExtensionsClient, cfg.ResyncInterval, runtimePerms).
		WithGatewayFactory(cfg.GatewayInformerFactory, cfg.GatewayAPIPresence)
	return runtimePerms, factory
}

func newIngestInfrastructure(cfg Config, factory *informer.Factory, runtimePerms *permissions.Checker) (*ingest.IngestManager, error) {
	clusterMeta := snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName}
	manager := ingest.NewIngestManager(
		streamrows.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName},
		cfg.KubernetesClient,
		cfg.APIExtensionsClient,
		cfg.GatewayClient,
		cfg.AllowedNamespaces...,
	)
	manager.SetDynamicClient(cfg.DynamicClient)
	registerIngestProjectors(manager, cfg.ClusterID)
	jobControllerOwners := snapshot.NewJobControllerOwnerIndex()
	registerPodReflector(manager, factory, clusterMeta, jobControllerOwners.Lookup)
	if err := registerWorkloadReflectors(manager, clusterMeta); err != nil {
		return nil, err
	}
	if !manager.AddBundleSink(snapshot.JobGVR, jobControllerOwners) {
		return nil, fmt.Errorf("register Job owner sink: Job ingest store is unavailable")
	}
	registerNetworkReflectors(manager, clusterMeta)
	registerNodeReflector(manager, clusterMeta)
	manager.SetPermissionFilter(ingestPermissionFilter(runtimePerms))
	return manager, nil
}

type permissionIssueRecorder struct {
	issues []PermissionIssue
}

func (r *permissionIssueRecorder) append(domainName, resource string, errs ...error) {
	err := errors.Join(errs...)
	if err == nil {
		return
	}
	r.issues = append(r.issues, PermissionIssue{Domain: domainName, Resource: resource, Err: err})
}

func logPermissionSkip(domainName, group, resource string) {
	klog.V(2).Infof("Skipping registration for domain %s: insufficient permission to list %s/%s", domainName, group, resource)
}

func newMetricsServices(cfg Config, gate *permissionGate, recorder *telemetry.Recorder, issues *permissionIssueRecorder) (refresh.MetricsPoller, metrics.Provider) {
	checks := []listCheck{
		{group: metricsAPIGroup, resource: "nodes"},
		{group: metricsAPIGroup, resource: "pods"},
	}
	results := gate.runListChecks(checks)
	metricErrors := gate.listErrors(results)
	issues.append("metrics-poller", metricsAPIGroup+"/nodes,pods", metricErrors...)
	if len(metricErrors) == 0 && gate.allListAllowed(results) {
		return newEnabledMetricsServices(cfg, recorder)
	}
	logPermissionSkip("metrics-poller", metricsAPIGroup, "nodes/pods")
	return newDisabledMetricsServices(cfg, gate, results, recorder)
}

func newEnabledMetricsServices(cfg Config, recorder *telemetry.Recorder) (refresh.MetricsPoller, metrics.Provider) {
	poller := metrics.NewPoller(cfg.MetricsClient, cfg.RestConfig, cfg.MetricsInterval, recorder)
	poller.SetLogger(applog.ClusterScoped(cfg.Logger, cfg.ClusterID, cfg.ClusterName))
	poller.SetAllowedNamespaces(cfg.AllowedNamespaces)
	demandPoller := metrics.NewDemandPoller(poller, poller, cfg.MetricsInterval*3)
	return demandPoller, demandPoller
}

func newDisabledMetricsServices(cfg Config, gate *permissionGate, results []listCheckResult, recorder *telemetry.Recorder) (refresh.MetricsPoller, metrics.Provider) {
	nodesErr := gate.listErrFor(results, metricsAPIGroup, "nodes")
	podsErr := gate.listErrFor(results, metricsAPIGroup, "pods")
	reason, detail := disabledMetricsReason(gate.listAllowedByKey(results), nodesErr, podsErr)
	applog.Warn(cfg.Logger, detail, "Metrics")
	disabled := metrics.NewDisabledPoller(recorder, reason)
	return disabled, disabled
}

func disabledMetricsReason(allowed map[string]bool, nodesErr, podsErr error) (string, string) {
	if nodesErr == nil && podsErr == nil {
		return "Insufficient permissions for Metrics API", fmt.Sprintf(
			"metrics polling disabled: access denied for %s (nodesAllowed=%t podsAllowed=%t)",
			metricsAPIGroup,
			allowed[metricsAPIGroup+"/nodes"],
			allowed[metricsAPIGroup+"/pods"],
		)
	}
	return "Metrics API not found (metrics-server)", fmt.Sprintf(
		"metrics polling disabled: metrics API discovery failed (nodesErr=%v podsErr=%v)",
		nodesErr,
		podsErr,
	)
}

func restServerHost(cfg *rest.Config) string {
	if cfg == nil {
		return ""
	}
	return cfg.Host
}

func registerSubsystemDomains(factory *informer.Factory, gate *permissionGate, runtimePerms *permissions.Checker, registrations []domainRegistration) error {
	preflight := preflightRequests(registrations, []informer.PermissionRequest{
		{Group: metricsAPIGroup, Resource: "nodes", Verb: "list"},
		{Group: metricsAPIGroup, Resource: "pods", Verb: "list"},
	})
	ctx, cancel := context.WithTimeout(context.Background(), config.PermissionPreflightTimeout)
	defer cancel()
	_ = factory.PrimePermissions(ctx, preflight)
	return registerDomains(ctx, gate, runtimePerms, registrations)
}

func wireStreamObservers(
	eventManager *eventstream.Manager,
	resourceManager *resourcestream.Manager,
	metricsPoller refresh.MetricsPoller,
	snapshotService *snapshot.Service,
	namespaceNotifier *snapshot.NamespaceChangeNotifier,
	objectEventsNotifier *snapshot.ObjectEventsChangeNotifier,
	attentionIndex *snapshot.ClusterAttentionIndex,
) *NamespacesDoorbellObserver {
	if resourceManager != nil {
		resourceManager.SetSnapshotDomainInvalidator(snapshotService.InvalidateDomainCache)
		wireMetricsObserver(metricsPoller, resourceManager)
	}
	if eventManager != nil && resourceManager != nil {
		eventManager.SetSignalObserver(eventSignalObserver(resourceManager))
	}
	observer := &NamespacesDoorbellObserver{}
	if resourceManager == nil {
		return observer
	}
	if namespaceNotifier != nil {
		wireNamespacesDoorbell(namespaceNotifier, resourceManager, observer)
	}
	if objectEventsNotifier != nil {
		wireObjectEventsDoorbell(objectEventsNotifier, resourceManager)
	}
	if attentionIndex != nil {
		wireClusterAttentionDoorbell(attentionIndex, resourceManager)
	}
	return observer
}

func wireMetricsObserver(metricsPoller refresh.MetricsPoller, resourceManager *resourcestream.Manager) {
	if observable, ok := metricsPoller.(interface {
		SetCollectionObserver(func(metrics.Metadata))
	}); ok {
		observable.SetCollectionObserver(metricsSignalObserver(resourceManager))
	}
}

// NewSubsystemWithServices returns a fully wired refresh subsystem.
func NewSubsystemWithServices(cfg Config) (*Subsystem, error) {
	registry := domain.New()
	runtimePerms, informerFactory := newInformerInfrastructure(cfg)
	ingestManager, err := newIngestInfrastructure(cfg, informerFactory, runtimePerms)
	if err != nil {
		return nil, err
	}
	informerHub := newIngestInformerHub(informerFactory, ingestManager)
	issues := &permissionIssueRecorder{}
	gate := newPermissionGate(registry, informerFactory, issues.append, logPermissionSkip)

	telemetryRecorder := telemetry.NewRecorder()
	telemetryRecorder.SetClusterMeta(cfg.ClusterID, cfg.ClusterName)

	clusterMeta := snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName}
	metricsPoller, metricsProvider := newMetricsServices(cfg, gate, telemetryRecorder, issues)

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
		serverHost:      restServerHost(cfg.RestConfig),
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
	if err := registerSubsystemDomains(informerFactory, gate, runtimePerms, registrations); err != nil {
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

	containerLogsHandler, eventManager, resourceManager, err := registerStreamHandlers(streamDeps{
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
	namespacesDoorbellObserver := wireStreamObservers(
		eventManager,
		resourceManager,
		metricsPoller,
		snapshotService,
		namespaceNotifier,
		objectEventsNotifier,
		attentionIndex,
	)

	return &Subsystem{
		Manager:              manager,
		Handler:              mux,
		Telemetry:            telemetryRecorder,
		PermissionIssues:     issues.issues,
		InformerFactory:      informerFactory,
		IngestManager:        ingestManager,
		RuntimePerms:         runtimePerms,
		Registry:             registry,
		SnapshotService:      snapshotService,
		ManualQueue:          queue,
		EventStream:          eventManager,
		ResourceStream:       resourceManager,
		ContainerLogs:        containerLogsHandler,
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
