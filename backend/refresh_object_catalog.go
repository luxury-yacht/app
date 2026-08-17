package backend

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	refreshinformer "github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	informers "k8s.io/client-go/informers"
)

// CatalogDiagnostics summarizes the catalog feature state for manual inspection.
type CatalogDiagnostics struct {
	Enabled             bool                       `json:"enabled"`
	ItemCount           int                        `json:"itemCount"`
	ResourceCount       int                        `json:"resourceCount"`
	LastSyncMs          int64                      `json:"lastSyncMs"`
	LastUpdated         int64                      `json:"lastUpdated"`
	LastError           string                     `json:"lastError,omitempty"`
	LastSuccessMs       int64                      `json:"lastSuccessMs,omitempty"`
	Status              string                     `json:"status,omitempty"`
	ConsecutiveFailures int                        `json:"consecutiveFailures,omitempty"`
	Stale               bool                       `json:"stale,omitempty"`
	FailedResources     int                        `json:"failedResources,omitempty"`
	FallbackCount       uint64                     `json:"fallbackCount,omitempty"`
	HydrationCount      uint64                     `json:"hydrationCount,omitempty"`
	Health              *CatalogHealth             `json:"health,omitempty"`
	Domains             []CatalogDomainDiagnostics `json:"domains,omitempty"`
}

// CatalogDomainDiagnostics captures per-domain telemetry details.
type CatalogDomainDiagnostics struct {
	Domain            string                       `json:"domain"`
	Scope             string                       `json:"scope,omitempty"`
	LastStatus        telemetry.SnapshotLastStatus `json:"lastStatus"`
	LastError         string                       `json:"lastError,omitempty"`
	LastWarning       string                       `json:"lastWarning,omitempty"`
	LastDurationMs    int64                        `json:"lastDurationMs"`
	AverageDurationMs int64                        `json:"averageDurationMs,omitempty"`
	SuccessCount      uint64                       `json:"successCount,omitempty"`
	FailureCount      uint64                       `json:"failureCount,omitempty"`
	TotalItems        int                          `json:"totalItems,omitempty"`
	Truncated         bool                         `json:"truncated,omitempty"`
	FallbackCount     uint64                       `json:"fallbackCount,omitempty"`
	HydrationCount    uint64                       `json:"hydrationCount,omitempty"`
}

// CatalogHealth summarises the live health of the catalog service.
type CatalogHealth struct {
	Status              string `json:"status"`
	ConsecutiveFailures int    `json:"consecutiveFailures"`
	LastSyncMs          int64  `json:"lastSyncMs"`
	LastSuccessMs       int64  `json:"lastSuccessMs,omitempty"`
	LastError           string `json:"lastError,omitempty"`
	Stale               bool   `json:"stale"`
	FailedResources     int    `json:"failedResources,omitempty"`
}

// CatalogQueryCSVExport describes a file-backed catalog query export.
type CatalogQueryCSVExport struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
}

type objectCatalogEntry struct {
	service *objectcatalog.Service
	cancel  context.CancelFunc
	done    chan struct{}
	meta    ClusterMeta
}

type catalogTarget struct {
	selection kubeconfigSelection
	meta      ClusterMeta
}

// objectCatalogServiceForCluster returns the catalog service for a specific cluster ID.
func (a *RefreshCoordinator) objectCatalogServiceForCluster(clusterID string) *objectcatalog.Service {
	if a == nil {
		return nil
	}
	a.objectCatalogMu.Lock()
	defer a.objectCatalogMu.Unlock()
	if clusterID == "" {
		return nil
	}
	entry := a.objectCatalogEntries[clusterID]
	if entry == nil {
		return nil
	}
	return entry.service
}

// ensureObjectCatalogForCluster makes the object catalog part of the live-tier
// invariant. Rebuild normally starts it, but this also repairs a live subsystem
// left catalog-less by an interrupted or previously mis-ordered transition.
func (a *RefreshCoordinator) ensureObjectCatalogForCluster(clusterID string) error {
	if a == nil || clusterID == "" {
		return fmt.Errorf("cluster identifier missing")
	}
	if a.objectCatalogServiceForCluster(clusterID) != nil {
		return nil
	}
	clients := a.clusterRuntime.clusterClientsForID(clusterID)
	if clients == nil || clients.kubeconfigPath == "" {
		return fmt.Errorf("cluster selection unavailable")
	}
	target := catalogTarget{
		selection: kubeconfigSelection{Path: clients.kubeconfigPath, Context: clients.kubeconfigContext},
		meta:      clients.meta,
	}
	if err := a.startObjectCatalogForTarget(target); err != nil {
		return err
	}
	if a.objectCatalogServiceForCluster(clusterID) == nil {
		return fmt.Errorf("object catalog did not start")
	}
	return nil
}

func (a *RefreshCoordinator) startObjectCatalogForTarget(target catalogTarget) error {
	if target.meta.ID == "" {
		return fmt.Errorf("cluster identifier missing")
	}
	// Cold clusters deliberately have no live informer/ingest producers. Starting
	// their catalogs would run discovery and capability checks, then repeatedly try
	// to collect from stores whose feeds the governor intentionally stopped.
	if a.governorKeepsClusterCold(target.meta.ID) {
		return nil
	}

	clients := a.clusterRuntime.clusterClientsForID(target.meta.ID)
	if clients == nil {
		return fmt.Errorf("cluster clients unavailable")
	}

	subsystem := a.getRefreshSubsystem(target.meta.ID)
	if subsystem == nil || subsystem.InformerFactory == nil {
		return fmt.Errorf("refresh subsystem informers unavailable")
	}

	commonDeps := a.clusterRuntime.resourceDependenciesForSelection(target.selection, clients, target.meta.ID)
	telemetryRecorder := objectcatalog.TelemetryRecorder(nil)
	if subsystem.Telemetry != nil {
		telemetryRecorder = subsystem.Telemetry
	} else if recorder := a.currentTelemetryRecorder(); recorder != nil {
		telemetryRecorder = recorder
	}

	deps := objectcatalog.Dependencies{
		Common:                       commonDeps,
		Logger:                       applog.ClusterScoped(a.logger, target.meta.ID, target.meta.Name),
		Telemetry:                    telemetryRecorder,
		InformerFactory:              subsystem.InformerFactory.SharedInformerFactory(),
		APIExtensionsInformerFactory: subsystem.InformerFactory.APIExtensionsInformerFactory(),
		GatewayInformerFactory:       subsystem.InformerFactory.GatewayInformerFactory(),
		PermissionChecker:            subsystem.InformerFactory,
		IngestSource:                 subsystem.IngestManager,
		CapabilityFactory: func() *capabilities.Service {
			return capabilities.NewService(capabilities.Dependencies{
				Common:             commonDeps,
				WorkerCount:        32,
				RequestsPerSecond:  0,
				RateLimiterFactory: func(float64) capabilities.RateLimiter { return nil },
			})
		},
		Now:       time.Now,
		ClusterID: target.meta.ID,
		// The cluster's namespace scope (docs/architecture/namespace-scope.md):
		// namespaced collection fans out per configured namespace.
		AllowedNamespaces: a.refreshAllowedNamespaces(target.meta.ID),
		// The catalog waits for informer caches INSIDE sync, between the RBAC
		// preflight and the collect, so discovery + preflight overlap the factory's
		// initial sync instead of running after it (see Dependencies.WaitForCaches).
		WaitForCaches: func(waitCtx context.Context) error {
			return a.waitForCatalogInformerCaches(waitCtx, subsystem.InformerFactory)
		},
	}

	svc := objectcatalog.NewService(deps, nil)
	ctx, cancel := context.WithCancel(a.CtxOrBackground())
	done := make(chan struct{})
	if subsystem.ResourceStream != nil {
		catalogUpdates, cancelCatalogUpdates := svc.SubscribeStreaming()
		go func() {
			defer cancelCatalogUpdates()
			runCatalogDoorbellBridge(ctx, catalogUpdates, subsystem.ResourceStream)
		}()
	}
	if subsystem.AttentionIndex != nil {
		finalizerUpdates, cancelFinalizerUpdates := svc.SubscribeFinalizerBlockers()
		go func() {
			defer cancelFinalizerUpdates()
			runCatalogFinalizerBridge(ctx, finalizerUpdates, svc.FinalizerBlockers, subsystem.AttentionIndex)
		}()
	}

	a.storeObjectCatalogEntry(target.meta.ID, &objectCatalogEntry{
		service: svc,
		cancel:  cancel,
		done:    done,
		meta:    target.meta,
	})

	if telemetryRecorder != nil {
		telemetryRecorder.RecordCatalog(true, 0, 0, 0, nil)
	}

	go func() {
		defer close(done)
		// No cache wait here: the service starts immediately so discovery and the
		// RBAC preflight overlap the informer factory's initial sync; sync() itself
		// waits for caches just before the collect (deps.WaitForCaches above).
		if err := svc.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			a.logger.Warn(fmt.Sprintf("Object catalog terminated unexpectedly: %v", err), logsources.ObjectCatalog, target.meta.ID, target.meta.Name)
		}
	}()

	return nil
}

func runCatalogFinalizerBridge(
	ctx context.Context,
	updates <-chan objectcatalog.FinalizerBlockerUpdate,
	blockers func() []objectcatalog.FinalizerBlocker,
	index *snapshot.ClusterAttentionIndex,
) {
	if blockers == nil || index == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-updates:
			if !ok {
				return
			}
			index.ReplaceFinalizerBlockers(blockers())
		}
	}
}

func runCatalogDoorbellBridge(ctx context.Context, updates <-chan objectcatalog.StreamingUpdate, manager *resourcestream.Manager) {
	if manager == nil {
		return
	}
	var sequence uint64
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-updates:
			if !ok {
				return
			}
			sequence++
			manager.BroadcastCatalogRefresh(fmt.Sprintf("%d", sequence))
		}
	}
}

func (a *RefreshCoordinator) stopObjectCatalog() {
	entries := a.clearObjectCatalogEntries()
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		if entry.cancel != nil {
			entry.cancel()
		}
	}
	for _, entry := range entries {
		a.waitForObjectCatalogDone(entry)
	}

	if recorder := a.currentTelemetryRecorder(); recorder != nil {
		recorder.RecordCatalog(false, 0, 0, 0, nil)
	}
}

func (a *RefreshCoordinator) waitForCatalogInformerCaches(ctx context.Context, factory *refreshinformer.Factory) error {
	if factory == nil {
		return fmt.Errorf("informer factory not initialised")
	}
	if !waitForFactorySync(ctx, factory.SharedInformerFactory()) {
		return fmt.Errorf("shared informer cache sync failed")
	}
	if !waitForAPIExtensionsFactorySync(ctx, factory.APIExtensionsInformerFactory()) {
		return fmt.Errorf("apiextensions informer cache sync failed")
	}
	return nil
}

func (a *RefreshCoordinator) storeObjectCatalogEntry(clusterID string, entry *objectCatalogEntry) {
	if clusterID == "" || entry == nil {
		return
	}
	a.objectCatalogMu.Lock()
	if a.objectCatalogEntries == nil {
		a.objectCatalogEntries = make(map[string]*objectCatalogEntry)
	}
	a.objectCatalogEntries[clusterID] = entry
	a.objectCatalogMu.Unlock()
	a.resourceProjection.publishCatalogEntry(clusterID, entry)
}

func (a *RefreshCoordinator) clearObjectCatalogEntries() []*objectCatalogEntry {
	a.objectCatalogMu.Lock()
	entries := make([]*objectCatalogEntry, 0, len(a.objectCatalogEntries))
	for _, entry := range a.objectCatalogEntries {
		entries = append(entries, entry)
	}
	a.objectCatalogEntries = make(map[string]*objectCatalogEntry)
	a.objectCatalogMu.Unlock()
	a.resourceProjection.clearCatalogEntries()
	return entries
}

func (a *RefreshCoordinator) removeObjectCatalogEntry(clusterID string) *objectCatalogEntry {
	a.objectCatalogMu.Lock()
	entry := a.objectCatalogEntries[clusterID]
	delete(a.objectCatalogEntries, clusterID)
	a.objectCatalogMu.Unlock()
	a.resourceProjection.removeCatalogEntry(clusterID)
	return entry
}

func (a *RefreshCoordinator) stopObjectCatalogForCluster(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	entry := a.removeObjectCatalogEntry(clusterID)
	if entry == nil {
		return
	}
	if entry.cancel != nil {
		entry.cancel()
	}
	a.waitForObjectCatalogDone(entry)
}

func (a *RefreshCoordinator) waitForObjectCatalogDone(entry *objectCatalogEntry) {
	if entry == nil || entry.done == nil {
		return
	}
	timeout := config.RefreshShutdownTimeout
	if timeout <= 0 {
		<-entry.done
		return
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-entry.done:
	case <-timer.C:
		if a != nil && a.logger != nil {
			a.logger.Warn("Timed out waiting for object catalog shutdown", logsources.ObjectCatalog, entry.meta.ID, entry.meta.Name)
		}
	}
}

func (a *RefreshCoordinator) snapshotObjectCatalogEntries() []*objectCatalogEntry {
	a.objectCatalogMu.Lock()
	defer a.objectCatalogMu.Unlock()
	entries := make([]*objectCatalogEntry, 0, len(a.objectCatalogEntries))
	for _, entry := range a.objectCatalogEntries {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i] == nil || entries[j] == nil {
			return entries[i] != nil
		}
		return entries[i].meta.ID < entries[j].meta.ID
	})
	return entries
}

// catalogNamespaceGroups returns per-cluster namespace listings for catalog snapshots.
func (a *RefreshCoordinator) catalogNamespaceGroups() []snapshot.CatalogNamespaceGroup {
	entries := a.snapshotObjectCatalogEntries()
	if len(entries) == 0 {
		return nil
	}

	groups := make([]snapshot.CatalogNamespaceGroup, 0, len(entries))
	for _, entry := range entries {
		if entry == nil || entry.service == nil || entry.meta.ID == "" {
			continue
		}
		namespaces := entry.service.Namespaces()
		// A scoped cluster's namespace list is synthesized from the
		// configured scope (docs/architecture/namespace-scope.md) so Browse agrees
		// with the sidebar even before anything is catalogued.
		if scope := a.allowedNamespaces(entry.meta.ID); len(scope) > 0 {
			namespaces = append([]string(nil), scope...)
			sort.Strings(namespaces)
		}
		if len(namespaces) == 0 {
			continue
		}
		groups = append(groups, snapshot.CatalogNamespaceGroup{
			ClusterMeta: snapshot.ClusterMeta{
				ClusterID:   entry.meta.ID,
				ClusterName: entry.meta.Name,
			},
			Namespaces: namespaces,
		})
	}
	return groups
}

func waitForFactorySync(ctx context.Context, factory informers.SharedInformerFactory) bool {
	if factory == nil {
		return true
	}
	synced := factory.WaitForCacheSync(ctx.Done())
	if ctx.Err() != nil {
		return false
	}
	for _, ok := range synced {
		if !ok {
			return false
		}
	}
	return true
}

func waitForAPIExtensionsFactorySync(ctx context.Context, factory apiextinformers.SharedInformerFactory) bool {
	if factory == nil {
		return true
	}
	synced := factory.WaitForCacheSync(ctx.Done())
	if ctx.Err() != nil {
		return false
	}
	for _, ok := range synced {
		if !ok {
			return false
		}
	}
	return true
}

func applyCatalogTelemetry(diag *CatalogDiagnostics, status *telemetry.CatalogStatus) {
	diag.Enabled = diag.Enabled || status.Enabled
	diag.ItemCount = status.ItemCount
	diag.ResourceCount = status.ResourceCount
	diag.LastSyncMs = status.LastSyncMs
	diag.LastUpdated = status.LastUpdated
	diag.LastError = status.LastError
	diag.LastSuccessMs = status.LastSuccess
	diag.Status = status.Status
	diag.ConsecutiveFailures = status.ConsecutiveFailures
	diag.Stale = status.Stale
	diag.FailedResources = status.FailedResourceCount
}

func applyCatalogDomainTelemetry(diag *CatalogDiagnostics, snapshots []telemetry.SnapshotStatus) {
	if len(snapshots) == 0 {
		return
	}
	diag.Domains = make([]CatalogDomainDiagnostics, 0, len(snapshots))
	for _, snapshot := range snapshots {
		diag.Domains = append(diag.Domains, catalogDomainDiagnostics(snapshot))
		diag.FallbackCount += snapshot.FallbackCount
		diag.HydrationCount += snapshot.HydrationCount
	}
}

func catalogDomainDiagnostics(snapshot telemetry.SnapshotStatus) CatalogDomainDiagnostics {
	return CatalogDomainDiagnostics{
		Domain: snapshot.Domain, Scope: snapshot.Scope, LastStatus: snapshot.LastStatus,
		LastError: snapshot.LastError, LastWarning: snapshot.LastWarning,
		LastDurationMs: snapshot.LastDurationMs, AverageDurationMs: snapshot.AverageDurationMs,
		SuccessCount: snapshot.SuccessCount, FailureCount: snapshot.FailureCount,
		TotalItems: snapshot.TotalItems, Truncated: snapshot.Truncated,
		FallbackCount: snapshot.FallbackCount, HydrationCount: snapshot.HydrationCount,
	}
}

// singleCatalogHealth deliberately refuses to choose a cluster when diagnostics
// aggregate multiple active catalog entries.
func singleCatalogHealth(entries []*objectCatalogEntry) *CatalogHealth {
	if len(entries) != 1 || entries[0] == nil || entries[0].service == nil {
		return nil
	}
	health := entries[0].service.Health()
	if health.Status == objectcatalog.HealthStateUnknown {
		return nil
	}
	return &CatalogHealth{
		Status: string(health.Status), ConsecutiveFailures: health.ConsecutiveFailures,
		LastSyncMs: health.LastSync.UnixMilli(), LastSuccessMs: health.LastSuccess.UnixMilli(),
		LastError: health.LastError, Stale: health.Stale, FailedResources: health.FailedResources,
	}
}

func mergeCatalogHealth(diag *CatalogDiagnostics, health *CatalogHealth) {
	if health == nil {
		return
	}
	diag.Health = health
	if diag.Status == "" || diag.Status == "disabled" {
		diag.Status = health.Status
	}
	if diag.ConsecutiveFailures == 0 && health.ConsecutiveFailures > 0 {
		diag.ConsecutiveFailures = health.ConsecutiveFailures
	}
	if !diag.Stale && health.Stale {
		diag.Stale = true
	}
	if diag.FailedResources == 0 && health.FailedResources > 0 {
		diag.FailedResources = health.FailedResources
	}
	if diag.LastSuccessMs == 0 && health.LastSuccessMs > 0 {
		diag.LastSuccessMs = health.LastSuccessMs
	}
	if diag.LastSyncMs == 0 && health.LastSyncMs > 0 {
		diag.LastSyncMs = health.LastSyncMs
	}
	if diag.LastError == "" && health.LastError != "" {
		diag.LastError = health.LastError
	}
}

const catalogCustomHydrationConcurrency = 16

type catalogHydrationRequest struct {
	row  snapshot.ResourceQueryRow
	gvr  schema.GroupVersionResource
	name string
}

func catalogHydrationRequestForRow(clusterID string, row snapshot.ResourceQueryRow) (catalogHydrationRequest, error) {
	rowClusterID := strings.TrimSpace(row.ClusterID)
	if rowClusterID == "" {
		return catalogHydrationRequest{}, fmt.Errorf("custom row %q is missing clusterId", row.Name)
	}
	if rowClusterID != clusterID {
		return catalogHydrationRequest{}, fmt.Errorf("row clusterId %q does not match request clusterId %q", row.ClusterID, clusterID)
	}
	if strings.TrimSpace(row.Kind) == "" || strings.TrimSpace(row.Version) == "" || strings.TrimSpace(row.Resource) == "" {
		return catalogHydrationRequest{}, fmt.Errorf("custom row %q is missing kind, version, or resource", row.Name)
	}
	name := strings.TrimSpace(row.Name)
	if name == "" {
		return catalogHydrationRequest{}, fmt.Errorf("custom row is missing name")
	}
	return catalogHydrationRequest{row: row, name: name, gvr: schema.GroupVersionResource{
		Group: strings.TrimSpace(row.Group), Version: strings.TrimSpace(row.Version), Resource: strings.TrimSpace(row.Resource),
	}}, nil
}

func hydrateCatalogRequests(ctx context.Context, client dynamic.Interface, meta snapshot.ClusterMeta, requests []catalogHydrationRequest) ([]snapshot.CustomResourceSummary, []bool) {
	result := make([]snapshot.CustomResourceSummary, len(requests))
	included := make([]bool, len(requests))
	sem := make(chan struct{}, catalogCustomHydrationConcurrency)
	var wg sync.WaitGroup
	for index, req := range requests {
		index := index
		req := req
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			summary, ok := hydrateCatalogCustomRow(ctx, client, meta, req.row, req.gvr, req.name)
			if !ok {
				return
			}
			result[index] = summary
			included[index] = true
		}()
	}
	wg.Wait()
	return result, included
}

func compactCatalogHydrationResults(result []snapshot.CustomResourceSummary, included []bool) []snapshot.CustomResourceSummary {
	compacted := make([]snapshot.CustomResourceSummary, 0, len(result))
	for index, summary := range result {
		if included[index] {
			compacted = append(compacted, summary)
		}
	}
	return compacted
}

func hydrateCatalogCustomRow(
	ctx context.Context,
	client dynamic.Interface,
	meta snapshot.ClusterMeta,
	row snapshot.ResourceQueryRow,
	gvr schema.GroupVersionResource,
	name string,
) (snapshot.CustomResourceSummary, bool) {
	resource := client.Resource(gvr)
	var (
		obj *unstructured.Unstructured
		err error
	)
	if namespace := strings.TrimSpace(row.Namespace); namespace != "" {
		obj, err = resource.Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = resource.Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		if apierrors.IsNotFound(err) {
			return snapshot.CustomResourceSummary{}, false
		}
		return failedCatalogCustomHydrationSummary(meta, row), true
	}
	crdName := row.Resource
	if row.Group != "" {
		crdName = row.Resource + "." + row.Group
	}
	if row.Namespace != "" {
		return snapshot.CustomResourceSummaryFromNamespace(customresource.BuildNamespaceStreamSummary(
			meta,
			obj, customresource.NewDescriptor(

				row.Group,
				row.Version,
				row.Resource,
				row.Kind,
				crdName),

			row.Namespace)), true
	}
	return snapshot.CustomResourceSummaryFromCluster(customresource.BuildClusterStreamSummary(
		meta,
		obj, customresource.NewDescriptor(

			row.Group,
			row.Version,
			row.Resource,
			row.Kind,
			crdName))), true
}

func failedCatalogCustomHydrationSummary(meta snapshot.ClusterMeta, row snapshot.ResourceQueryRow) snapshot.CustomResourceSummary {
	crdName := row.Resource
	if row.Group != "" {
		crdName = row.Resource + "." + row.Group
	}
	return snapshot.CustomResourceSummary{
		Ref:                resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: meta.ClusterID, Group: row.Group, Version: row.Version, Kind: row.Kind, Resource: row.Resource, Namespace: row.Namespace, Name: row.Name, UID: ""}),
		CRDName:            crdName,
		Status:             "Hydration failed",
		StatusState:        "warning",
		StatusPresentation: "warning",
	}
}
