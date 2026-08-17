package backend

import (
	"context"
	"fmt"
	"sync"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// resourceRetryTelemetry is the retry-only telemetry seam used by resource
// requests. Refresh currently supplies the implementation; Phase 5B moves that
// implementation without changing the resource boundary.
type resourceRetryTelemetry interface {
	RecordRetryAttempt(error)
	RecordRetrySuccess()
	RecordRetryExhausted(error)
}

type resourceGatewayDependencies struct {
	resolveClusterDependencies       func(string) (common.Dependencies, string, error)
	resourceDependenciesForClusterID func(string) (common.Dependencies, bool)
	context                          func() context.Context
	emitEvent                        func(string, ...interface{})
	logger                           *Logger
	clusterName                      func(string) string
	recordTransportSuccess           func(string)
	recordTransportFailure           func(string, string, error)
	retryTelemetry                   func() resourceRetryTelemetry
	catalogServiceForCluster         func(string) *objectcatalog.Service
	resourceResolverForCluster       func(string) common.ResourceResolver
	catalogEntries                   func() []*objectCatalogEntry
	catalogTelemetry                 func() telemetry.Summarizer
	permissionFetchPolicy            *PermissionFetchPolicy
	containerLogsSelectionPolicy     *ContainerLogsSelectionPolicy
	operations                       *OperationsCoordinator
}

// ResourceGateway is the request-shaped owner for Kubernetes resource reads,
// mutations, permissions, object actions, and their short-lived response cache.
// It deliberately stores narrow collaborators rather than the application
// composition root.
type ResourceGateway struct {
	resolveClusterDependenciesFn       func(string) (common.Dependencies, string, error)
	resourceDependenciesForClusterIDFn func(string) (common.Dependencies, bool)
	contextFn                          func() context.Context
	emitEventFn                        func(string, ...interface{})
	logger                             *Logger
	clusterNameFn                      func(string) string
	recordTransportSuccessFn           func(string)
	recordTransportFailureFn           func(string, string, error)
	retryTelemetryFn                   func() resourceRetryTelemetry
	catalogServiceForClusterFn         func(string) *objectcatalog.Service
	resourceResolverForClusterFn       func(string) common.ResourceResolver
	catalogEntriesFn                   func() []*objectCatalogEntry
	catalogTelemetryFn                 func() telemetry.Summarizer
	permissionFetchPolicy              *PermissionFetchPolicy
	containerLogsSelectionPolicy       *ContainerLogsSelectionPolicy
	operations                         *OperationsCoordinator

	responseCache *responseCache
	ssrrCachesMu  sync.Mutex
	ssrrCaches    map[string]*capabilities.SSRRCache
}

func newResourceGateway(dependencies resourceGatewayDependencies) *ResourceGateway {
	contextProvider := dependencies.context
	if contextProvider == nil {
		contextProvider = context.Background
	}
	permissionPolicy := dependencies.permissionFetchPolicy
	if permissionPolicy == nil {
		permissionPolicy = NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency)
	}
	containerLogsPolicy := dependencies.containerLogsSelectionPolicy
	if containerLogsPolicy == nil {
		containerLogsPolicy = NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit)
	}
	return &ResourceGateway{
		resolveClusterDependenciesFn:       dependencies.resolveClusterDependencies,
		resourceDependenciesForClusterIDFn: dependencies.resourceDependenciesForClusterID,
		contextFn:                          contextProvider,
		emitEventFn:                        dependencies.emitEvent,
		logger:                             dependencies.logger,
		clusterNameFn:                      dependencies.clusterName,
		recordTransportSuccessFn:           dependencies.recordTransportSuccess,
		recordTransportFailureFn:           dependencies.recordTransportFailure,
		retryTelemetryFn:                   dependencies.retryTelemetry,
		catalogServiceForClusterFn:         dependencies.catalogServiceForCluster,
		resourceResolverForClusterFn:       dependencies.resourceResolverForCluster,
		catalogEntriesFn:                   dependencies.catalogEntries,
		catalogTelemetryFn:                 dependencies.catalogTelemetry,
		permissionFetchPolicy:              permissionPolicy,
		containerLogsSelectionPolicy:       containerLogsPolicy,
		operations:                         dependencies.operations,
		responseCache:                      newDefaultResponseCache(),
		ssrrCaches:                         make(map[string]*capabilities.SSRRCache),
	}
}

func (g *ResourceGateway) CtxOrBackground() context.Context {
	if g == nil || g.contextFn == nil {
		return context.Background()
	}
	if ctx := g.contextFn(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func (g *ResourceGateway) resolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	if g == nil || g.resolveClusterDependenciesFn == nil {
		return common.Dependencies{}, "", fmt.Errorf("resource gateway cluster access is not configured")
	}
	deps, selectionKey, err := g.resolveClusterDependenciesFn(clusterID)
	if err != nil {
		return common.Dependencies{}, "", err
	}
	return g.withResourcePolicies(deps, selectionKey), selectionKey, nil
}

func (g *ResourceGateway) resourceDependenciesForClusterID(clusterID string) (common.Dependencies, bool) {
	if g == nil || g.resourceDependenciesForClusterIDFn == nil {
		return common.Dependencies{}, false
	}
	deps, ok := g.resourceDependenciesForClusterIDFn(clusterID)
	if !ok {
		return common.Dependencies{}, false
	}
	return g.withResourcePolicies(deps, clusterID), true
}

func (g *ResourceGateway) withResourcePolicies(deps common.Dependencies, clusterID string) common.Dependencies {
	if g.resourceResolverForClusterFn != nil {
		deps.ResourceResolver = g.resourceResolverForClusterFn(clusterID)
	} else {
		deps.ResourceResolver = nil
	}
	deps.ContainerLogsPerScopeTargetLimit = g.containerLogsSelectionPolicy.Limit()
	return deps
}

type resourceGatewayCatalogResolver struct {
	clusterID string
	lookup    func(string) *objectcatalog.Service
}

func (r resourceGatewayCatalogResolver) ResolveResourceForGVK(
	ctx context.Context,
	gvk schema.GroupVersionKind,
) (common.ResolvedResource, bool, error) {
	if r.lookup == nil {
		return common.ResolvedResource{}, false, nil
	}
	service := r.lookup(r.clusterID)
	if service == nil {
		return common.ResolvedResource{}, false, nil
	}
	return service.ResolveResourceForGVK(ctx, gvk)
}

func (g *ResourceGateway) objectCatalogServiceForCluster(clusterID string) *objectcatalog.Service {
	if g == nil || g.catalogServiceForClusterFn == nil {
		return nil
	}
	return g.catalogServiceForClusterFn(clusterID)
}

func (g *ResourceGateway) snapshotObjectCatalogEntries() []*objectCatalogEntry {
	if g == nil || g.catalogEntriesFn == nil {
		return nil
	}
	return g.catalogEntriesFn()
}

func (g *ResourceGateway) telemetrySummary() (telemetry.Summary, bool) {
	if g == nil || g.catalogTelemetryFn == nil {
		return telemetry.Summary{}, false
	}
	summarizer := g.catalogTelemetryFn()
	if summarizer == nil {
		return telemetry.Summary{}, false
	}
	return summarizer.SnapshotSummary(), true
}

func (g *ResourceGateway) clusterNameForID(clusterID string) string {
	if g == nil || g.clusterNameFn == nil {
		return clusterID
	}
	return g.clusterNameFn(clusterID)
}

func (g *ResourceGateway) emitEvent(name string, args ...interface{}) {
	if g != nil && g.emitEventFn != nil {
		g.emitEventFn(name, args...)
	}
}

func (g *ResourceGateway) recordClusterTransportSuccess(clusterID string) {
	if g != nil && g.recordTransportSuccessFn != nil {
		g.recordTransportSuccessFn(clusterID)
	}
}

func (g *ResourceGateway) recordClusterTransportFailure(clusterID, reason string, err error) {
	if g != nil && g.recordTransportFailureFn != nil {
		g.recordTransportFailureFn(clusterID, reason, err)
	}
}

func (g *ResourceGateway) retryTelemetry() resourceRetryTelemetry {
	if g == nil || g.retryTelemetryFn == nil {
		return nil
	}
	return g.retryTelemetryFn()
}

func (g *ResourceGateway) resourceRetryDependencies() resourceRetryDependencies {
	if g == nil {
		return resourceRetryDependencies{}
	}
	return resourceRetryDependencies{
		recordSuccess: g.recordClusterTransportSuccess,
		recordFailure: g.recordClusterTransportFailure,
		telemetry:     g.retryTelemetry,
		logger:        g.logger,
		clusterName:   g.clusterNameForID,
	}
}

func (g *ResourceGateway) logResourceFetchError(err error, message, clusterID string) {
	if g == nil || g.logger == nil {
		return
	}
	g.logger.ErrorWithCause(err, message, logsources.ResourceLoader, clusterID, g.clusterNameForID(clusterID))
}

func (g *ResourceGateway) clearCaches() {
	if g == nil {
		return
	}
	g.responseCache.clear()
	g.ClearAllSSRRCaches()
}
