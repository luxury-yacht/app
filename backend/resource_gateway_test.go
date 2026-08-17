package backend

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestResourceGatewayNarrowCollaboratorDefaultsAndDelegation(t *testing.T) {
	var nilGateway *ResourceGateway
	if nilGateway.CtxOrBackground() == nil {
		t.Fatal("nil gateway must provide a background context")
	}
	if _, _, err := nilGateway.resolveClusterDependencies("cluster-a"); err == nil {
		t.Fatal("nil gateway must reject cluster resolution")
	}
	if _, ok := nilGateway.resourceDependenciesForClusterID("cluster-a"); ok {
		t.Fatal("nil gateway must not return resource dependencies")
	}
	nilGateway.clearCaches()

	recorder := telemetry.NewRecorder()
	catalog := objectcatalog.NewService(objectcatalog.Dependencies{
		Common:    common.Dependencies{KubernetesClient: cgofake.NewClientset()},
		ClusterID: "cluster-a",
	}, nil)
	refreshProjection := newRefreshResourceProjection()
	refreshProjection.publishCatalogEntry("cluster-a", &objectCatalogEntry{service: catalog, meta: ClusterMeta{ID: "cluster-a"}})
	refreshProjection.publishTelemetry(recorder)
	var (
		eventCalled            bool
		transportSuccessCalled bool
		transportFailureCalled bool
	)
	gateway := newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies: func(clusterID string) (common.Dependencies, string, error) {
			return common.Dependencies{ClusterID: clusterID}, clusterID, nil
		},
		resourceDependenciesForClusterID: func(clusterID string) (common.Dependencies, bool) {
			return common.Dependencies{ClusterID: clusterID}, true
		},
		context: func() context.Context { return nil },
		emitEvent: func(string, ...interface{}) {
			eventCalled = true
		},
		logger:      NewLogger(10),
		clusterName: func(string) string { return "Cluster A" },
		recordTransportSuccess: func(string) {
			transportSuccessCalled = true
		},
		recordTransportFailure: func(string, string, error) {
			transportFailureCalled = true
		},
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return resourceGatewayCatalogResolver{clusterID: clusterID, lookup: func(string) *objectcatalog.Service { return catalog }}
		},
		refreshProjection: refreshProjection,
	})

	if gateway.CtxOrBackground() == nil {
		t.Fatal("nil collaborator context must fall back to background")
	}
	deps, selectionKey, err := gateway.resolveClusterDependencies("cluster-a")
	if err != nil || selectionKey != "cluster-a" || deps.ClusterID != "cluster-a" || deps.ResourceResolver == nil {
		t.Fatalf("resolved dependencies = (%+v, %q, %v)", deps, selectionKey, err)
	}
	if deps, ok := gateway.resourceDependenciesForClusterID("cluster-a"); !ok || deps.ClusterID != "cluster-a" || deps.ResourceResolver == nil {
		t.Fatalf("resource dependencies = (%+v, %t)", deps, ok)
	}
	if got := gateway.objectCatalogServiceForCluster("cluster-a"); got != catalog {
		t.Fatalf("catalog service = %p, want %p", got, catalog)
	}
	if entries := gateway.snapshotObjectCatalogEntries(); entries == nil {
		t.Fatal("catalog entries collaborator was not used")
	}
	if _, ok := gateway.telemetrySummary(); !ok {
		t.Fatal("catalog telemetry collaborator was not used")
	}
	if got := gateway.clusterNameForID("cluster-a"); got != "Cluster A" {
		t.Fatalf("cluster name = %q", got)
	}
	if gateway.retryTelemetry() != recorder || gateway.resourceRetryDependencies().telemetry() != recorder {
		t.Fatal("retry telemetry collaborator was not used")
	}

	gateway.emitEvent("resource:test")
	gateway.recordClusterTransportSuccess("cluster-a")
	gateway.recordClusterTransportFailure("cluster-a", "failure", errors.New("boom"))
	gateway.logResourceFetchError(errors.New("boom"), "fetch failed", "cluster-a")
	if !eventCalled || !transportSuccessCalled || !transportFailureCalled {
		t.Fatalf("collaborator calls: event=%t success=%t failure=%t", eventCalled, transportSuccessCalled, transportFailureCalled)
	}
	gateway.clearCaches()

	resolver := resourceGatewayCatalogResolver{}
	if _, ok, err := resolver.ResolveResourceForGVK(context.Background(), corev1.SchemeGroupVersion.WithKind("Pod")); err != nil || ok {
		t.Fatalf("resolver without catalog = (ok=%t, err=%v)", ok, err)
	}
}

func TestRefreshCoordinatorPublishesCatalogAndTelemetryToResourceProjection(t *testing.T) {
	refresh := newRefreshCoordinator()
	catalog := objectcatalog.NewService(objectcatalog.Dependencies{
		Common:    common.Dependencies{KubernetesClient: cgofake.NewClientset()},
		ClusterID: "cluster-a",
	}, nil)
	entry := &objectCatalogEntry{service: catalog, meta: ClusterMeta{ID: "cluster-a"}}
	recorder := telemetry.NewRecorder()

	refresh.storeObjectCatalogEntry("cluster-a", entry)
	refresh.setTelemetryRecorder(recorder)
	require.Same(t, catalog, refresh.resourceProjection.objectCatalogServiceForCluster("cluster-a"))
	require.Same(t, recorder, refresh.resourceProjection.currentTelemetry())

	refresh.removeObjectCatalogEntry("cluster-a")
	refresh.setTelemetryRecorder(nil)
	require.Nil(t, refresh.resourceProjection.objectCatalogServiceForCluster("cluster-a"))
	require.Nil(t, refresh.resourceProjection.currentTelemetry())
}

func TestResourceGatewayUsesDefaultAndLiveRuntimePolicies(t *testing.T) {
	defaultGateway := newResourceGateway(resourceGatewayDependencies{})
	if got := defaultGateway.permissionFetchPolicy.Concurrency(); got != defaultPermissionSSRRFetchConcurrency {
		t.Fatalf("default permission concurrency = %d, want %d", got, defaultPermissionSSRRFetchConcurrency)
	}
	if got := defaultGateway.withResourcePolicies(common.Dependencies{}, "cluster-a").ContainerLogsPerScopeTargetLimit; got != defaultObjPanelLogsTargetPerScopeLimit {
		t.Fatalf("default container-log limit = %d, want %d", got, defaultObjPanelLogsTargetPerScopeLimit)
	}

	permissionPolicy := NewPermissionFetchPolicy(3)
	containerLogsPolicy := NewContainerLogsSelectionPolicy(7)
	gateway := newResourceGateway(resourceGatewayDependencies{
		permissionFetchPolicy:        permissionPolicy,
		containerLogsSelectionPolicy: containerLogsPolicy,
	})
	if got := gateway.permissionFetchPolicy.Concurrency(); got != 3 {
		t.Fatalf("configured permission concurrency = %d, want 3", got)
	}
	if got := gateway.withResourcePolicies(common.Dependencies{}, "cluster-a").ContainerLogsPerScopeTargetLimit; got != 7 {
		t.Fatalf("configured container-log limit = %d, want 7", got)
	}

	permissionPolicy.SetPermissionFetchConcurrency(1)
	containerLogsPolicy.SetContainerLogsPerScopeLimit(2)
	if got := gateway.permissionFetchPolicy.Concurrency(); got != 1 {
		t.Fatalf("live permission concurrency = %d, want 1", got)
	}
	if got := gateway.withResourcePolicies(common.Dependencies{}, "cluster-a").ContainerLogsPerScopeTargetLimit; got != 2 {
		t.Fatalf("live container-log limit = %d, want 2", got)
	}
}

func TestResourceGatewayResumesRequestsAfterAuthRecovery(t *testing.T) {
	const clusterID = "cluster-auth-recovery"
	manager := authstate.New(authstate.Config{MaxAttempts: 0})
	client := cgofake.NewClientset(&corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "settings", Namespace: "default"},
	})
	fixture := newResourceGatewayFixture()
	fixture.setCluster(clusterID, &clusterClients{
		meta:        ClusterMeta{ID: clusterID, Name: "Recovered"},
		client:      client,
		authManager: manager,
	})

	manager.ReportFailure("expired credentials")
	if _, err := fixture.gateway.GetConfigMap(clusterID, "default", "settings"); err == nil || !strings.Contains(err.Error(), "auth failed for Recovered") {
		t.Fatalf("request during failed auth = %v, want cluster auth failure", err)
	}

	manager.ReportSuccess()
	detail, err := fixture.gateway.GetConfigMap(clusterID, "default", "settings")
	if err != nil {
		t.Fatalf("request after auth recovery: %v", err)
	}
	if detail == nil || detail.Name != "settings" {
		t.Fatalf("request after auth recovery returned %#v", detail)
	}
}
