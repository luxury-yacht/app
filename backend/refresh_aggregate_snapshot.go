package backend

import (
	"context"
	"fmt"
	"maps"
	"sort"
	"sync"
	"time"

	"k8s.io/klog/v2"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateSnapshotService routes cluster-scoped snapshot builds to per-cluster services.
type aggregateSnapshotService struct {
	clusterOrder []string
	services     map[string]refresh.SnapshotBuilder
	mu           sync.RWMutex

	// onNamespaceSnapshot is called when a namespace snapshot reaches a settled workload state.
	// Used by the lifecycle module to transition loading -> degraded -> ready.
	onNamespaceSnapshot func(clusterID string, readiness snapshot.NamespaceWorkloadReadiness)
}

// newAggregateSnapshotService builds an aggregator for the provided cluster snapshot services.
func newAggregateSnapshotService(
	clusterOrder []string,
	subsystems map[string]*system.Subsystem,
) *aggregateSnapshotService {
	services := make(map[string]refresh.SnapshotBuilder)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.SnapshotService == nil {
			continue
		}
		services[id] = subsystem.SnapshotService
	}

	ordered := make([]string, 0, len(clusterOrder))
	for _, id := range clusterOrder {
		if _, ok := services[id]; ok {
			ordered = append(ordered, id)
		}
	}

	if len(ordered) == 0 {
		for id := range services {
			ordered = append(ordered, id)
		}
		sort.Strings(ordered)
	}

	return &aggregateSnapshotService{
		clusterOrder: ordered,
		services:     services,
	}
}

// Build routes one cluster-scoped snapshot request to the owning per-cluster service.
func (s *aggregateSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	services := s.snapshotConfig()
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(scope)
	target, err := s.resolveTarget(domain, clusterIDs, services)
	if err != nil {
		return nil, err
	}

	service := services[target]
	if service == nil {
		return nil, fmt.Errorf("snapshot service unavailable for %s", target)
	}
	scoped := refresh.JoinClusterScope(target, scopeValue)
	snapshotData, err := service.Build(ctx, domain, scoped)
	if err != nil {
		// A permission-denied namespaces domain is a SETTLED answer to "is the
		// cluster's data loaded" — there is no namespace list this user may
		// load. The Ready transition only ever fires from the namespaces
		// domain, so without this signal a restricted-RBAC cluster wedges in
		// "loading" forever. The error still propagates: the client renders
		// the permission message instead of a namespace list.
		if domain == "namespaces" && refresh.IsPermissionDenied(err) {
			s.notifyNamespaceSnapshot(target, snapshot.NamespaceWorkloadReady)
		}
		return nil, err
	}

	// Notify the lifecycle module only once workload startup is settled. Deadline settlement
	// produces Degraded (usable but incomplete); actual sync or an explicit permission skip
	// produces Ready. Pending snapshots still serve the fast namespace paint without claiming
	// either settled state. Later builds carry Degraded -> Ready recovery through the same callback.
	if domain == "namespaces" {
		readiness := namespaceSnapshotWorkloadReadiness(snapshotData)
		if readiness != snapshot.NamespaceWorkloadPending {
			s.notifyNamespaceSnapshot(target, readiness)
		}
	}
	return snapshotData, nil
}

// namespaceSnapshotWorkloadReadiness reads the typed backend-only workload startup state. A
// non-namespace payload is defensively treated as pending.
func namespaceSnapshotWorkloadReadiness(snap *refresh.Snapshot) snapshot.NamespaceWorkloadReadiness {
	if snap == nil {
		return snapshot.NamespaceWorkloadPending
	}
	payload, ok := snap.Payload.(snapshot.NamespaceSnapshot)
	if !ok {
		return snapshot.NamespaceWorkloadPending
	}
	return payload.WorkloadReadiness
}

// resolveTarget chooses which cluster should handle the requested domain/scope pair.
func (s *aggregateSnapshotService) resolveTarget(
	domain string,
	clusterIDs []string,
	services map[string]refresh.SnapshotBuilder,
) (string, error) {
	if len(clusterIDs) == 0 {
		return "", fmt.Errorf("cluster scope is required for domain %s", domain)
	}
	if len(clusterIDs) > 1 {
		return "", fmt.Errorf("domain %s requires a single cluster scope (requested: %v)", domain, clusterIDs)
	}

	target := clusterIDs[0]
	if _, ok := services[target]; !ok {
		return "", fmt.Errorf("no active clusters available (requested: %v)", clusterIDs)
	}
	return target, nil
}

func (s *aggregateSnapshotService) snapshotConfig() map[string]refresh.SnapshotBuilder {
	s.mu.RLock()
	defer s.mu.RUnlock()
	services := make(map[string]refresh.SnapshotBuilder, len(s.services))
	maps.Copy(services, s.services)
	return services
}

// Update refreshes the aggregate snapshot configuration after selection changes.
func (s *aggregateSnapshotService) Update(clusterOrder []string, subsystems map[string]*system.Subsystem) {
	if s == nil {
		return
	}
	next := newAggregateSnapshotService(clusterOrder, subsystems)
	s.mu.Lock()
	s.clusterOrder = next.clusterOrder
	s.services = next.services
	s.mu.Unlock()
}

// notifyNamespaceSnapshot fires the lifecycle callback for a successful namespace snapshot.
func (s *aggregateSnapshotService) notifyNamespaceSnapshot(clusterID string, readiness snapshot.NamespaceWorkloadReadiness) {
	if s.onNamespaceSnapshot == nil {
		return
	}
	s.onNamespaceSnapshot(clusterID, readiness)
}

// runNamespacesReadinessSelfBuild closes the cluster workload-readiness loop server-side.
// Settled and Ready transitions only ever fire from a namespaces snapshot build
// (Build → notifyNamespaceSnapshot above), and historically that build was
// requested by the FRONTEND — a chain of lifecycle-event relays, scope
// derivation, and fetch machinery whose failure wedged clusters in
// loading/loading_slow with no retry (observed in the field: app opened on
// the Overview view, zero namespaces requests, status stuck until a view
// switch). The namespaces doorbell notifier re-arms until a post-settle
// build lands, so self-building here on each pending/degraded doorbell converges
// without frontend involvement — and pre-warms the cache the doorbell just
// invalidated. In steady state (ready) it is a no-op.
func runNamespacesReadinessSelfBuild(
	lifecycle *clusterLifecycle,
	aggregate *aggregateSnapshotService,
	clusterID string,
) {
	if lifecycle == nil || aggregate == nil || clusterID == "" {
		return
	}
	state := lifecycle.GetState(clusterID)
	if state != ClusterStateLoading && state != ClusterStateLoadingSlow && state != ClusterStateDegraded {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := aggregate.Build(ctx, "namespaces", refresh.JoinClusterScope(clusterID, "")); err != nil {
		// The doorbell re-arms until a settled build lands; the next ring
		// retries. Permission-denied namespaces flip readiness via the
		// error path inside Build.
		klog.V(2).Infof("namespaces readiness self-build for %s: %v", clusterID, err)
	}
}
