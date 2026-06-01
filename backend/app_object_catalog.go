package backend

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	refreshinformer "github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
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
	Domain            string `json:"domain"`
	Scope             string `json:"scope,omitempty"`
	LastStatus        string `json:"lastStatus"`
	LastError         string `json:"lastError,omitempty"`
	LastWarning       string `json:"lastWarning,omitempty"`
	LastDurationMs    int64  `json:"lastDurationMs"`
	AverageDurationMs int64  `json:"averageDurationMs,omitempty"`
	SuccessCount      uint64 `json:"successCount,omitempty"`
	FailureCount      uint64 `json:"failureCount,omitempty"`
	TotalItems        int    `json:"totalItems,omitempty"`
	Truncated         bool   `json:"truncated,omitempty"`
	FallbackCount     uint64 `json:"fallbackCount,omitempty"`
	HydrationCount    uint64 `json:"hydrationCount,omitempty"`
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

// catalogTargets returns the ordered set of cluster selections to catalogue.
func (a *App) catalogTargets() []catalogTarget {
	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		selections = nil
	}

	if len(selections) == 0 {
		return nil
	}

	targets := make([]catalogTarget, 0, len(selections))
	for _, selection := range selections {
		meta := a.clusterMetaForSelection(selection)
		if meta.ID == "" {
			continue
		}
		targets = append(targets, catalogTarget{selection: selection, meta: meta})
	}
	return targets
}

// objectCatalogServiceForCluster returns the catalog service for a specific cluster ID.
func (a *App) objectCatalogServiceForCluster(clusterID string) *objectcatalog.Service {
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

func (a *App) startObjectCatalog() {
	if a == nil || a.Ctx == nil {
		return
	}

	a.stopObjectCatalog()

	targets := a.catalogTargets()
	if len(targets) == 0 {
		return
	}

	for _, target := range targets {
		if err := a.startObjectCatalogForTarget(target); err != nil {
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", target.meta.ID, err), logsources.ObjectCatalog, target.meta.ID, target.meta.Name)
			}
			continue
		}
	}
}

func (a *App) startObjectCatalogForTarget(target catalogTarget) error {
	if target.meta.ID == "" {
		return fmt.Errorf("cluster identifier missing")
	}

	clients := a.clusterClientsForID(target.meta.ID)
	if clients == nil {
		return fmt.Errorf("cluster clients unavailable")
	}

	subsystem := a.getRefreshSubsystem(target.meta.ID)
	if subsystem == nil || subsystem.InformerFactory == nil {
		return fmt.Errorf("refresh subsystem informers unavailable")
	}

	commonDeps := a.resourceDependenciesForSelection(target.selection, clients, target.meta.ID)
	telemetryRecorder := objectcatalog.Telemetry(nil)
	if subsystem.Telemetry != nil {
		telemetryRecorder = subsystem.Telemetry
	} else if a.telemetryRecorder != nil {
		telemetryRecorder = a.telemetryRecorder
	}

	deps := objectcatalog.Dependencies{
		Common:                       commonDeps,
		Logger:                       applog.ClusterScoped(a.logger, target.meta.ID, target.meta.Name),
		Telemetry:                    telemetryRecorder,
		InformerFactory:              subsystem.InformerFactory.SharedInformerFactory(),
		APIExtensionsInformerFactory: subsystem.InformerFactory.APIExtensionsInformerFactory(),
		GatewayInformerFactory:       subsystem.InformerFactory.GatewayInformerFactory(),
		PermissionChecker:            subsystem.InformerFactory,
		CapabilityFactory: func() *capabilities.Service {
			return capabilities.NewService(capabilities.Dependencies{
				Common:             commonDeps,
				WorkerCount:        32,
				RequestsPerSecond:  0,
				RateLimiterFactory: func(float64) capabilities.RateLimiter { return nil },
			})
		},
		Now:         time.Now,
		ClusterID:   target.meta.ID,
		ClusterName: target.meta.Name,
	}

	svc := objectcatalog.NewService(deps, nil)
	ctx, cancel := context.WithCancel(a.CtxOrBackground())
	done := make(chan struct{})

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
		if err := a.waitForCatalogInformerCaches(ctx, subsystem.InformerFactory); err != nil {
			if !errors.Is(err, context.Canceled) && a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Object catalog waiting for informer caches failed: %v", err), logsources.ObjectCatalog, target.meta.ID, target.meta.Name)
			}
			if ctx.Err() != nil {
				return
			}
		}
		if err := svc.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			a.logger.Warn(fmt.Sprintf("Object catalog terminated unexpectedly: %v", err), logsources.ObjectCatalog, target.meta.ID, target.meta.Name)
		}
	}()

	return nil
}

func (a *App) stopObjectCatalog() {
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
		if entry == nil || entry.done == nil {
			continue
		}
		<-entry.done
	}

	if a.telemetryRecorder != nil {
		a.telemetryRecorder.RecordCatalog(false, 0, 0, 0, nil)
	}
}

func (a *App) waitForCatalogInformerCaches(ctx context.Context, factory *refreshinformer.Factory) error {
	if factory == nil {
		return fmt.Errorf("informer factory not initialised")
	}
	if ok := waitForFactorySync(ctx, factory.SharedInformerFactory()); !ok {
		return fmt.Errorf("shared informer cache sync failed")
	}
	if ok := waitForAPIExtensionsFactorySync(ctx, factory.APIExtensionsInformerFactory()); !ok {
		return fmt.Errorf("apiextensions informer cache sync failed")
	}
	return nil
}

func (a *App) storeObjectCatalogEntry(clusterID string, entry *objectCatalogEntry) {
	if clusterID == "" || entry == nil {
		return
	}
	a.objectCatalogMu.Lock()
	defer a.objectCatalogMu.Unlock()
	if a.objectCatalogEntries == nil {
		a.objectCatalogEntries = make(map[string]*objectCatalogEntry)
	}
	a.objectCatalogEntries[clusterID] = entry
}

func (a *App) clearObjectCatalogEntries() []*objectCatalogEntry {
	a.objectCatalogMu.Lock()
	defer a.objectCatalogMu.Unlock()
	entries := make([]*objectCatalogEntry, 0, len(a.objectCatalogEntries))
	for _, entry := range a.objectCatalogEntries {
		entries = append(entries, entry)
	}
	a.objectCatalogEntries = make(map[string]*objectCatalogEntry)
	return entries
}

func (a *App) removeObjectCatalogEntry(clusterID string) *objectCatalogEntry {
	a.objectCatalogMu.Lock()
	defer a.objectCatalogMu.Unlock()
	entry := a.objectCatalogEntries[clusterID]
	delete(a.objectCatalogEntries, clusterID)
	return entry
}

func (a *App) stopObjectCatalogForCluster(clusterID string) {
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
	if entry.done != nil {
		<-entry.done
	}
}

func (a *App) snapshotObjectCatalogEntries() []*objectCatalogEntry {
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
func (a *App) catalogNamespaceGroups() []snapshot.CatalogNamespaceGroup {
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

// GetCatalogDiagnostics returns the latest catalog telemetry snapshot for diagnostics tools.
func (a *App) GetCatalogDiagnostics() (*CatalogDiagnostics, error) {
	diag := &CatalogDiagnostics{}
	entries := a.snapshotObjectCatalogEntries()
	if len(entries) > 0 {
		diag.Enabled = true
	}
	if a.telemetryRecorder == nil {
		return diag, nil
	}

	summary := a.telemetryRecorder.SnapshotSummary()
	if summary.Catalog == nil {
		return diag, nil
	}

	diag.Enabled = diag.Enabled || summary.Catalog.Enabled
	diag.ItemCount = summary.Catalog.ItemCount
	diag.ResourceCount = summary.Catalog.ResourceCount
	diag.LastSyncMs = summary.Catalog.LastSyncMs
	diag.LastUpdated = summary.Catalog.LastUpdated
	diag.LastError = summary.Catalog.LastError
	diag.LastSuccessMs = summary.Catalog.LastSuccess
	diag.Status = summary.Catalog.Status
	diag.ConsecutiveFailures = summary.Catalog.ConsecutiveFailures
	diag.Stale = summary.Catalog.Stale
	diag.FailedResources = summary.Catalog.FailedResourceCount

	if len(summary.Snapshots) > 0 {
		diag.Domains = make([]CatalogDomainDiagnostics, 0, len(summary.Snapshots))
		for _, snap := range summary.Snapshots {
			domainDiag := CatalogDomainDiagnostics{
				Domain:            snap.Domain,
				Scope:             snap.Scope,
				LastStatus:        snap.LastStatus,
				LastError:         snap.LastError,
				LastWarning:       snap.LastWarning,
				LastDurationMs:    snap.LastDurationMs,
				AverageDurationMs: snap.AverageDurationMs,
				SuccessCount:      snap.SuccessCount,
				FailureCount:      snap.FailureCount,
				TotalItems:        snap.TotalItems,
				Truncated:         snap.Truncated,
				FallbackCount:     snap.FallbackCount,
				HydrationCount:    snap.HydrationCount,
			}
			diag.Domains = append(diag.Domains, domainDiag)
			diag.FallbackCount += snap.FallbackCount
			diag.HydrationCount += snap.HydrationCount
		}
	}

	// Only attach per-service health when a single catalog is active to avoid implying a preferred cluster.
	if len(entries) == 1 && entries[0] != nil && entries[0].service != nil {
		svc := entries[0].service
		health := svc.Health()
		if health.Status != objectcatalog.HealthStateUnknown {
			diag.Health = &CatalogHealth{
				Status:              string(health.Status),
				ConsecutiveFailures: health.ConsecutiveFailures,
				LastSyncMs:          health.LastSync.UnixMilli(),
				LastSuccessMs:       health.LastSuccess.UnixMilli(),
				LastError:           health.LastError,
				Stale:               health.Stale,
				FailedResources:     health.FailedResources,
			}
			if diag.Status == "" || diag.Status == "disabled" {
				diag.Status = diag.Health.Status
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
			if diag.LastSuccessMs == 0 && !health.LastSuccess.IsZero() {
				diag.LastSuccessMs = health.LastSuccess.UnixMilli()
			}
			if diag.LastSyncMs == 0 && !health.LastSync.IsZero() {
				diag.LastSyncMs = health.LastSync.UnixMilli()
			}
			if diag.LastError == "" && health.LastError != "" {
				diag.LastError = health.LastError
			}
		}
	}

	return diag, nil
}

// FindCatalogObjectMatch resolves a single catalog object in the requested
// cluster by canonical identity.
func (a *App) FindCatalogObjectMatch(
	clusterID, namespace, group, version, kind, name string,
) (*objectcatalog.Summary, error) {
	if a == nil {
		return nil, fmt.Errorf("app is not initialised")
	}

	trimmedClusterID := clusterID
	if trimmedClusterID == "" {
		return nil, fmt.Errorf("cluster ID is required")
	}
	if version == "" {
		return nil, fmt.Errorf("version is required")
	}
	if kind == "" {
		return nil, fmt.Errorf("kind is required")
	}
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}

	svc := a.objectCatalogServiceForCluster(trimmedClusterID)
	if svc == nil {
		return nil, fmt.Errorf("object catalog service unavailable for cluster %q", trimmedClusterID)
	}

	match, ok := svc.FindExactMatch(namespace, group, version, kind, name)
	if !ok {
		return nil, nil
	}

	return &match, nil
}

// FindCatalogObjectByUID resolves a single catalog object in the requested
// cluster by resource UID.
func (a *App) FindCatalogObjectByUID(clusterID, uid string) (*objectcatalog.Summary, error) {
	if a == nil {
		return nil, fmt.Errorf("app is not initialised")
	}

	trimmedClusterID := clusterID
	if trimmedClusterID == "" {
		return nil, fmt.Errorf("cluster ID is required")
	}
	trimmedUID := strings.TrimSpace(uid)
	if trimmedUID == "" {
		return nil, fmt.Errorf("uid is required")
	}

	svc := a.objectCatalogServiceForCluster(trimmedClusterID)
	if svc == nil {
		return nil, fmt.Errorf("object catalog service unavailable for cluster %q", trimmedClusterID)
	}

	match, ok := svc.FindByUID(trimmedUID)
	if !ok {
		return nil, nil
	}

	return &match, nil
}

// ExportCatalogQueryCSV exports every catalog object matching the provided
// query from the backend. The query is scoped to one cluster and uses catalog
// keyset pagination internally so the frontend does not need to load all rows.
func (a *App) ExportCatalogQueryCSV(
	clusterID string,
	kinds []string,
	namespaces []string,
	search string,
	sortField string,
	sortDirection string,
	customOnly bool,
) (string, error) {
	if a == nil {
		return "", fmt.Errorf("app is not initialised")
	}

	trimmedClusterID := strings.TrimSpace(clusterID)
	if trimmedClusterID == "" {
		return "", fmt.Errorf("cluster ID is required")
	}

	svc := a.objectCatalogServiceForCluster(trimmedClusterID)
	if svc == nil {
		return "", fmt.Errorf("object catalog service unavailable for cluster %q", trimmedClusterID)
	}

	return svc.ExportQueryCSV(objectcatalog.QueryOptions{
		Kinds:         kinds,
		Namespaces:    namespaces,
		Search:        search,
		SortField:     sortField,
		SortDirection: sortDirection,
		CustomOnly:    customOnly,
	})
}

// HydrateCatalogCustomRows fetches rich custom-resource row facts for the
// current catalog page. It intentionally works only on caller-provided page
// rows so production Custom tables keep catalog-backed paging without starting
// the legacy full CRD fanout domains.
func (a *App) HydrateCatalogCustomRows(clusterID string, rows []snapshot.ResourceQueryRow) ([]snapshot.CustomResourceSummary, error) {
	if a == nil {
		return nil, fmt.Errorf("app is not initialised")
	}
	trimmedClusterID := strings.TrimSpace(clusterID)
	if trimmedClusterID == "" {
		return nil, fmt.Errorf("cluster ID is required")
	}
	clients := a.clusterClientsForID(trimmedClusterID)
	if clients == nil || clients.dynamicClient == nil {
		return nil, fmt.Errorf("dynamic client unavailable for cluster %q", trimmedClusterID)
	}
	meta := snapshot.ClusterMeta{ClusterID: clients.meta.ID, ClusterName: clients.meta.Name}
	result := make([]snapshot.CustomResourceSummary, 0, len(rows))
	for _, row := range rows {
		if row.ClusterID != "" && row.ClusterID != trimmedClusterID {
			return nil, fmt.Errorf("row clusterId %q does not match request clusterId %q", row.ClusterID, trimmedClusterID)
		}
		if strings.TrimSpace(row.Kind) == "" || strings.TrimSpace(row.Version) == "" || strings.TrimSpace(row.Resource) == "" {
			return nil, fmt.Errorf("custom row %q is missing kind, version, or resource", row.Name)
		}
		gvr := schema.GroupVersionResource{
			Group:    strings.TrimSpace(row.Group),
			Version:  strings.TrimSpace(row.Version),
			Resource: strings.TrimSpace(row.Resource),
		}
		name := strings.TrimSpace(row.Name)
		if name == "" {
			return nil, fmt.Errorf("custom row is missing name")
		}
		resource := clients.dynamicClient.Resource(gvr)
		var (
			obj *unstructured.Unstructured
			err error
		)
		if namespace := strings.TrimSpace(row.Namespace); namespace != "" {
			obj, err = resource.Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
		} else {
			obj, err = resource.Get(context.Background(), name, metav1.GetOptions{})
		}
		if err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return nil, fmt.Errorf("hydrate custom row %s/%s/%s: %w", gvr.String(), row.Namespace, name, err)
		}
		crdName := row.Resource
		if row.Group != "" {
			crdName = row.Resource + "." + row.Group
		}
		if row.Namespace != "" {
			result = append(result, snapshot.CustomResourceSummaryFromNamespace(snapshot.BuildNamespaceCustomSummary(
				meta,
				obj,
				row.Group,
				row.Version,
				row.Kind,
				crdName,
				row.Namespace,
			)))
			continue
		}
		result = append(result, snapshot.CustomResourceSummaryFromCluster(snapshot.BuildClusterCustomSummary(
			meta,
			obj,
			row.Group,
			row.Version,
			row.Kind,
			crdName,
		)))
	}
	return result, nil
}

const catalogQueryBulkActionPageLimit = 100

// RunCatalogQueryBulkAction executes a query-wide catalog action from a durable
// selector instead of requiring the frontend to materialize every matching row.
// Only catalog-backed delete is currently supported because catalog rows carry
// the full GVK identity required by the existing object action permission path.
func (a *App) RunCatalogQueryBulkAction(req snapshot.QueryBulkActionRequest) (snapshot.QueryBulkActionResult, error) {
	var empty snapshot.QueryBulkActionResult
	if a == nil {
		return empty, fmt.Errorf("app is not initialised")
	}
	selection := req.Selection
	if selection.Table != "catalog" && selection.Table != "browse" {
		return empty, fmt.Errorf("query bulk action is unsupported for table %q", selection.Table)
	}
	if strings.TrimSpace(req.Action) != string(ObjectActionDelete) {
		return empty, fmt.Errorf("query bulk action %q is unsupported", req.Action)
	}
	clusterID := strings.TrimSpace(selection.ClusterID)
	if clusterID == "" {
		return empty, fmt.Errorf("cluster ID is required")
	}
	if !req.DryRun && !req.Confirmed {
		return snapshot.QueryBulkActionResult{RequiresConfirmation: true}, nil
	}

	svc := a.objectCatalogServiceForCluster(clusterID)
	if svc == nil {
		return empty, fmt.Errorf("object catalog service unavailable for cluster %q", clusterID)
	}
	limit := req.Limit
	if limit <= 0 || limit > catalogQueryBulkActionPageLimit {
		limit = catalogQueryBulkActionPageLimit
	}
	result := svc.Query(objectcatalog.QueryOptions{
		Kinds:         selection.Kinds,
		Namespaces:    selection.Namespaces,
		Search:        selection.Search,
		SortField:     selection.SortField,
		SortDirection: selection.SortDirection,
		CustomOnly:    selection.CustomOnly,
		Limit:         limit,
		Continue:      req.Continue,
	})

	response := snapshot.QueryBulkActionResult{
		Processed: len(result.Items),
		Continue:  result.ContinueToken,
	}
	for _, item := range result.Items {
		ref := catalogSummaryToResourceQueryRow(item)
		if req.DryRun {
			response.Succeeded++
			continue
		}
		apiVersion := item.Version
		if item.Group != "" {
			apiVersion = item.Group + "/" + item.Version
		}
		if err := a.deleteResourceByGVK(clusterID, apiVersion, item.Kind, item.Namespace, item.Name); err != nil {
			response.Failed++
			response.Failures = append(response.Failures, snapshot.QueryBulkActionFailure{
				Ref:     ref,
				Message: err.Error(),
			})
			continue
		}
		response.Succeeded++
	}
	return response, nil
}

func catalogSummaryToResourceQueryRow(item objectcatalog.Summary) snapshot.ResourceQueryRow {
	return snapshot.ResourceQueryRow{
		ClusterID: item.ClusterID,
		Group:     item.Group,
		Version:   item.Version,
		Kind:      item.Kind,
		Resource:  item.Resource,
		Namespace: item.Namespace,
		Name:      item.Name,
		UID:       item.UID,
	}
}
