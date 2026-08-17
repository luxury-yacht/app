package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"k8s.io/client-go/dynamic"
)

// GetCatalogDiagnostics returns the latest catalog telemetry snapshot for diagnostics tools.
func (g *ResourceGateway) GetCatalogDiagnostics() (*CatalogDiagnostics, error) {
	entries := g.snapshotObjectCatalogEntries()
	diag := &CatalogDiagnostics{Enabled: len(entries) > 0}
	summary, ok := g.telemetrySummary()
	if !ok {
		return diag, nil
	}
	if summary.Catalog == nil {
		return diag, nil
	}
	applyCatalogTelemetry(diag, summary.Catalog)
	applyCatalogDomainTelemetry(diag, summary.Snapshots)
	mergeCatalogHealth(diag, singleCatalogHealth(entries))
	return diag, nil
}

// FindCatalogObjectMatch resolves a single catalog object in the requested
// cluster by canonical identity.
func (g *ResourceGateway) FindCatalogObjectMatch(
	clusterID, namespace, group, version, kind, name string,
) (*objectcatalog.Summary, error) {
	if g == nil {
		return nil, fmt.Errorf("resource gateway is not initialised")
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

	svc := g.objectCatalogServiceForCluster(trimmedClusterID)
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
func (g *ResourceGateway) FindCatalogObjectByUID(clusterID, uid string) (*objectcatalog.Summary, error) {
	if g == nil {
		return nil, fmt.Errorf("resource gateway is not initialised")
	}

	trimmedClusterID := clusterID
	if trimmedClusterID == "" {
		return nil, fmt.Errorf("cluster ID is required")
	}
	trimmedUID := strings.TrimSpace(uid)
	if trimmedUID == "" {
		return nil, fmt.Errorf("uid is required")
	}

	svc := g.objectCatalogServiceForCluster(trimmedClusterID)
	if svc == nil {
		return nil, fmt.Errorf("object catalog service unavailable for cluster %q", trimmedClusterID)
	}

	match, ok := svc.FindByUID(trimmedUID)
	if !ok {
		return nil, nil
	}

	return &match, nil
}

// HydrateCatalogCustomRows fetches rich custom-resource row facts for the
// current catalog page. It intentionally works only on caller-provided page
// rows so production Custom tables keep catalog-backed paging without starting
// the legacy full CRD fanout domains.
func (g *ResourceGateway) HydrateCatalogCustomRows(clusterID string, rows []snapshot.ResourceQueryRow) ([]snapshot.CustomResourceSummary, error) {
	ctx, client, meta, requests, err := g.prepareCatalogHydration(clusterID, rows)
	if err != nil {
		return nil, err
	}
	result, included := hydrateCatalogRequests(ctx, client, meta, requests)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return compactCatalogHydrationResults(result, included), nil
}

func (g *ResourceGateway) prepareCatalogHydration(clusterID string, rows []snapshot.ResourceQueryRow) (context.Context, dynamic.Interface, snapshot.ClusterMeta, []catalogHydrationRequest, error) {
	if g == nil {
		return nil, nil, snapshot.ClusterMeta{}, nil, fmt.Errorf("resource gateway is not initialised")
	}
	trimmedClusterID := strings.TrimSpace(clusterID)
	if trimmedClusterID == "" {
		return nil, nil, snapshot.ClusterMeta{}, nil, fmt.Errorf("cluster ID is required")
	}
	deps, _, err := g.resolveClusterDependencies(trimmedClusterID)
	if err != nil {
		return nil, nil, snapshot.ClusterMeta{}, nil, err
	}
	if deps.DynamicClient == nil {
		return nil, nil, snapshot.ClusterMeta{}, nil, fmt.Errorf("dynamic client unavailable for cluster %q", trimmedClusterID)
	}
	meta := snapshot.ClusterMeta{ClusterID: deps.ClusterID, ClusterName: deps.ClusterName}
	ctx := g.CtxOrBackground()
	requests := make([]catalogHydrationRequest, 0, len(rows))
	for _, row := range rows {
		request, err := catalogHydrationRequestForRow(trimmedClusterID, row)
		if err != nil {
			return nil, nil, snapshot.ClusterMeta{}, nil, err
		}
		requests = append(requests, request)
	}
	return ctx, deps.DynamicClient, meta, requests, nil
}
