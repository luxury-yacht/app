package backend

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// resourceRetryTelemetry is the retry-only telemetry seam used by resource
// requests. Refresh supplies the current recorder without widening the resource
// boundary to refresh lifecycle state.
type resourceRetryTelemetry interface {
	RecordRetryAttempt(error)
	RecordRetrySuccess()
	RecordRetryExhausted(error)
}

// refreshResourceProjection is a leaf publication seam shared by refresh
// producers and resource consumers. Refresh pushes immutable references into
// it; resource requests never call back into RefreshCoordinator.
type refreshResourceProjection struct {
	mu        sync.RWMutex
	entries   map[string]*objectCatalogEntry
	telemetry *telemetry.Recorder
}

func newRefreshResourceProjection() *refreshResourceProjection {
	return &refreshResourceProjection{entries: make(map[string]*objectCatalogEntry)}
}

func (p *refreshResourceProjection) publishCatalogEntry(clusterID string, entry *objectCatalogEntry) {
	if p == nil || clusterID == "" || entry == nil {
		return
	}
	p.mu.Lock()
	p.entries[clusterID] = entry
	p.mu.Unlock()
}

func (p *refreshResourceProjection) removeCatalogEntry(clusterID string) {
	if p == nil || clusterID == "" {
		return
	}
	p.mu.Lock()
	delete(p.entries, clusterID)
	p.mu.Unlock()
}

func (p *refreshResourceProjection) clearCatalogEntries() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.entries = make(map[string]*objectCatalogEntry)
	p.mu.Unlock()
}

func (p *refreshResourceProjection) objectCatalogServiceForCluster(clusterID string) *objectcatalog.Service {
	if p == nil || clusterID == "" {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	entry := p.entries[clusterID]
	if entry == nil {
		return nil
	}
	return entry.service
}

func (p *refreshResourceProjection) snapshotObjectCatalogEntries() []*objectCatalogEntry {
	if p == nil {
		return nil
	}
	p.mu.RLock()
	entries := make([]*objectCatalogEntry, 0, len(p.entries))
	for _, entry := range p.entries {
		entries = append(entries, entry)
	}
	p.mu.RUnlock()
	sort.Slice(entries, func(i, j int) bool {
		if entries[i] == nil || entries[j] == nil {
			return entries[i] != nil
		}
		return entries[i].meta.ID < entries[j].meta.ID
	})
	return entries
}

func (p *refreshResourceProjection) publishTelemetry(recorder *telemetry.Recorder) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.telemetry = recorder
	p.mu.Unlock()
}

func (p *refreshResourceProjection) currentTelemetry() *telemetry.Recorder {
	if p == nil {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.telemetry
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
	resourceResolverForCluster       func(string) common.ResourceResolver
	refreshProjection                *refreshResourceProjection
	permissionFetchPolicy            *PermissionFetchPolicy
	containerLogsSelectionPolicy     *ContainerLogsSelectionPolicy
	nodeMaintenanceStore             *nodemaintenance.Store
	operations                       resourceGatewayOperations
}

type resourceGatewayOperations interface {
	CancelDrainNodeJob(string, string) error
	cancelDrainForClusterLifecycle(string, string, string)
	clusterOperationEpoch(string) uint64
	drainOperationFinished(string, string) bool
	registerDrainOperation(*nodemaintenance.DrainJob, uint64) bool
	startPortForwardAction(ObjectActionTargetRef, ObjectActionPortForwardOptions) (string, error)
	unregisterRuntimeOperation(string)
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
	resourceResolverForClusterFn       func(string) common.ResourceResolver
	refreshProjection                  *refreshResourceProjection
	permissionFetchPolicy              *PermissionFetchPolicy
	containerLogsSelectionPolicy       *ContainerLogsSelectionPolicy
	nodeMaintenanceStore               *nodemaintenance.Store
	operations                         resourceGatewayOperations

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
	refreshProjection := dependencies.refreshProjection
	if refreshProjection == nil {
		refreshProjection = newRefreshResourceProjection()
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
		resourceResolverForClusterFn:       dependencies.resourceResolverForCluster,
		refreshProjection:                  refreshProjection,
		permissionFetchPolicy:              permissionPolicy,
		containerLogsSelectionPolicy:       containerLogsPolicy,
		nodeMaintenanceStore:               dependencies.nodeMaintenanceStore,
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

func (g *ResourceGateway) objectCatalogServiceForCluster(clusterID string) *objectcatalog.Service {
	if g == nil {
		return nil
	}
	return g.refreshProjection.objectCatalogServiceForCluster(clusterID)
}

func (g *ResourceGateway) snapshotObjectCatalogEntries() []*objectCatalogEntry {
	if g == nil {
		return nil
	}
	return g.refreshProjection.snapshotObjectCatalogEntries()
}

func (g *ResourceGateway) telemetrySummary() (telemetry.Summary, bool) {
	if g == nil {
		return telemetry.Summary{}, false
	}
	summarizer := g.refreshProjection.currentTelemetry()
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
	if g == nil {
		return nil
	}
	recorder := g.refreshProjection.currentTelemetry()
	if recorder == nil {
		return nil
	}
	return recorder
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

func (g *ResourceGateway) logResourceFetchError(err error, message, clusterID, clusterName string) {
	if g == nil || g.logger == nil {
		return
	}
	if clusterName == "" {
		clusterName = g.clusterNameForID(clusterID)
	}
	g.logger.ErrorWithCause(err, message, logsources.ResourceLoader, clusterID, clusterName)
}

func (g *ResourceGateway) clearCaches() {
	if g == nil {
		return
	}
	g.responseCache.clear()
	g.ClearAllSSRRCaches()
}
