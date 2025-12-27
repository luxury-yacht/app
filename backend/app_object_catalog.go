package backend

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
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

func (a *App) startObjectCatalog() {
	if a == nil || a.Ctx == nil {
		return
	}

	a.stopObjectCatalog()

	var telemetryRecorder objectcatalog.Telemetry
	if a.telemetryRecorder != nil {
		telemetryRecorder = a.telemetryRecorder
	}

	// Use stable cluster identifiers for catalog summaries.
	clusterMeta := a.currentClusterMeta()
	deps := objectcatalog.Dependencies{
		Common:                       a.resourceDependencies(),
		Logger:                       a.logger,
		Telemetry:                    telemetryRecorder,
		InformerFactory:              a.sharedInformerFactory,
		APIExtensionsInformerFactory: a.apiExtensionsInformerFactory,
		CapabilityFactory: func() *capabilities.Service {
			return capabilities.NewService(capabilities.Dependencies{
				Common:             a.resourceDependencies(),
				WorkerCount:        32,
				RequestsPerSecond:  0,
				RateLimiterFactory: func(float64) capabilities.RateLimiter { return nil },
			})
		},
		Now: time.Now,
		ClusterID:   clusterMeta.ID,
		ClusterName: clusterMeta.Name,
	}

	svc := objectcatalog.NewService(deps, nil)
	ctx, cancel := context.WithCancel(a.CtxOrBackground())
	done := make(chan struct{})

	a.objectCatalogService = svc
	a.objectCatalogCancel = cancel
	a.objectCatalogDone = done

	if a.telemetryRecorder != nil {
		a.telemetryRecorder.RecordCatalog(true, 0, 0, 0, nil)
	}

	go func() {
		defer close(done)
		if err := a.waitForInformerCaches(ctx); err != nil {
			if !errors.Is(err, context.Canceled) && a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Object catalog waiting for informer caches failed: %v", err), "ObjectCatalog")
			}
			if ctx.Err() != nil {
				return
			}
		}
		if err := svc.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			a.logger.Warn(fmt.Sprintf("Object catalog terminated unexpectedly: %v", err), "ObjectCatalog")
		}
	}()
}

func (a *App) stopObjectCatalog() {
	if a.objectCatalogCancel != nil {
		a.objectCatalogCancel()
		a.objectCatalogCancel = nil
	}
	if a.objectCatalogDone != nil {
		<-a.objectCatalogDone
		a.objectCatalogDone = nil
	}
	a.objectCatalogService = nil

	if a.telemetryRecorder != nil {
		a.telemetryRecorder.RecordCatalog(false, 0, 0, 0, nil)
	}
}

func (a *App) waitForInformerCaches(ctx context.Context) error {
	if a.sharedInformerFactory != nil {
		if ok := waitForFactorySync(ctx, a.sharedInformerFactory); !ok {
			return fmt.Errorf("shared informer cache sync failed")
		}
	}
	if a.apiExtensionsInformerFactory != nil {
		if ok := waitForAPIExtensionsFactorySync(ctx, a.apiExtensionsInformerFactory); !ok {
			return fmt.Errorf("apiextensions informer cache sync failed")
		}
	}
	return nil
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
	if a.objectCatalogService != nil {
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

	if svc := a.objectCatalogService; svc != nil {
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
