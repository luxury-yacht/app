/*
 * backend/resource_bindings_test.go
 *
 * Tests for resource gateway operations.
 * - Ensures proper error handling when clients are missing.
 * - Verifies detail-cache eviction after mutations.
 */

package backend

import (
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

func wrapperResourceGatewayFixture(t *testing.T) *resourceGatewayFixture {
	t.Helper()
	return newResourceGatewayFixture()
}

func TestResourceActionsRequireClient(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)
	clusterID := "config:ctx"
	app.clusters = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	errorCases := []struct {
		name string
		call func() error
	}{
		{"deleteResourceByGVK", func() error {
			_, err := app.gateway.RunObjectAction(ObjectActionRequest{
				Action: ObjectActionDelete,
				Target: objectActionTarget(clusterID, "", "v1", "Pod", "ns", "name"),
			})
			return err
		}},
		{"HelmDelete", func() error {
			return app.gateway.deleteHelmReleaseAction(objectActionTarget(clusterID, "helm.sh", "v3", "HelmRelease", "ns", "rel"))
		}},
		{"Cordon", func() error {
			return app.gateway.cordonNodeAction(objectActionTarget(clusterID, "", "v1", "Node", "", "node"))
		}},
		{"Uncordon", func() error {
			return app.gateway.uncordonNodeAction(objectActionTarget(clusterID, "", "v1", "Node", "", "node"))
		}},
		{"Drain", func() error {
			return app.gateway.drainNodeAction(objectActionTarget(clusterID, "", "v1", "Node", "", "node"), DrainNodeOptions{})
		}},
		{"deleteNode", func() error {
			return app.gateway.deleteNodeAction(objectActionTarget(clusterID, "", "v1", "Node", "", "node"), false)
		}},
		{"forceDeleteNode", func() error {
			return app.gateway.deleteNodeAction(objectActionTarget(clusterID, "", "v1", "Node", "", "node"), true)
		}},
	}

	for _, tc := range errorCases {
		if err := tc.call(); err == nil {
			t.Fatalf("expected error for %s", tc.name)
		}
	}

	// Directly cover cache clearer when the response cache is unset.
	app.gateway.clearNodeCaches(clusterID, "node")
}

func TestFetchContainerLogsRejectsInvalidScopeCluster(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)

	_, err := app.gateway.FetchContainerLogs("cluster-a", ContainerLogsFetchRequest{SelectedFilters: []string{"container:app"}})
	if err == nil || !strings.Contains(err.Error(), "container logs scope is required") {
		t.Fatalf("expected missing scope error, got %v", err)
	}

	tests := []struct {
		name      string
		clusterID string
		scope     string
		want      string
	}{
		{
			name:      "missing scope cluster",
			clusterID: "cluster-a",
			scope:     "default:/v1:pod:demo",
			want:      "container logs scope requires a single cluster scope",
		},
		{
			name:      "mismatched scope cluster",
			clusterID: "cluster-a",
			scope:     "cluster-b|default:/v1:pod:demo",
			want:      "container logs scope cluster \"cluster-b\" does not match requested cluster \"cluster-a\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := app.gateway.FetchContainerLogs(tt.clusterID, ContainerLogsFetchRequest{Scope: tt.scope})
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected error containing %q, got %v", tt.want, err)
			}
			if reason := errorstatus.Classify(err).Reason; reason != errorstatus.ReasonBadRequest {
				t.Fatalf("expected a BadRequest status, got %s", reason)
			}
		})
	}
}

func TestGetContainerLogsScopeContainersRejectsInvalidScopeCluster(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)

	_, err := app.gateway.GetContainerLogsScopeContainers("cluster-a", "cluster-b|default:/v1:pod:demo")
	if err == nil || !strings.Contains(err.Error(), "container logs scope cluster \"cluster-b\" does not match requested cluster \"cluster-a\"") {
		t.Fatalf("expected mismatched scope cluster error, got %v", err)
	}
}

func TestDeletePodEvictsDetailCache(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)
	app.gateway.responseCache = newResponseCache(time.Minute, 10)
	clusterID := "config:ctx"
	client := cgofake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod",
			Namespace: "ns",
		},
	})
	allowSelfSubjectAccessReviews(client)
	app.clusters = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	podGVK := schema.GroupVersionKind{Version: "v1", Kind: "Pod"}
	detailKey := objectDetailCacheKeyForGVK(podGVK, "ns", "pod")
	headerKey := objectHeaderMetadataCacheKey(podGVK, "ns", "pod")
	app.gateway.seedResponseCache(clusterID, detailKey, "stale")
	app.gateway.seedResponseCache(clusterID, headerKey, "stale")

	if err := app.gateway.deletePodAction(objectActionTarget(clusterID, "", "v1", "Pod", "ns", "pod")); err != nil {
		t.Fatalf("deletePod returned error: %v", err)
	}
	for _, key := range []string{detailKey, headerKey} {
		if _, ok := app.gateway.responseCacheLookup(clusterID, key); ok {
			t.Fatalf("expected pod cache entry %q to be evicted", key)
		}
	}
}

func TestClearNodeCachesEvictsDetailCache(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)
	app.gateway.responseCache = newResponseCache(time.Minute, 10)
	clusterID := "config:ctx"
	nodeGVK := schema.GroupVersionKind{Version: "v1", Kind: "Node"}
	detailKey := objectDetailCacheKeyForGVK(nodeGVK, "", "node")
	headerKey := objectHeaderMetadataCacheKey(nodeGVK, "", "node")
	app.gateway.seedResponseCache(clusterID, detailKey, "stale")
	app.gateway.seedResponseCache(clusterID, headerKey, "stale")

	app.gateway.clearNodeCaches(clusterID, "node")

	for _, key := range []string{detailKey, headerKey} {
		if _, ok := app.gateway.responseCacheLookup(clusterID, key); ok {
			t.Fatalf("expected node cache entry %q to be evicted", key)
		}
	}
}

func TestPodAndHelmOperationsRequireClient(t *testing.T) {
	app := newResourceGatewayFixture()
	clusterID := "config:ctx"
	app.clusters = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	errorCases := []struct {
		name string
		call func() error
	}{
		{"deletePod", func() error {
			return app.gateway.deletePodAction(objectActionTarget(clusterID, "", "v1", "Pod", "ns", "pod"))
		}},
		{"PodContainers", func() error { _, err := app.gateway.GetPodContainers(clusterID, "ns", "pod"); return err }},
		{"HelmDelete", func() error {
			return app.gateway.deleteHelmReleaseAction(objectActionTarget(clusterID, "helm.sh", "v3", "HelmRelease", "ns", "rel"))
		}},
	}

	for _, tc := range errorCases {
		if err := tc.call(); err == nil {
			t.Fatalf("expected error for %s with nil client", tc.name)
		}
	}

	if _, err := app.gateway.FetchContainerLogs(clusterID, ContainerLogsFetchRequest{Scope: "cluster-a|ns:/v1:pod:pod"}); err == nil {
		t.Fatalf("expected error for FetchContainerLogs without client")
	}
}

func TestActionWrappersRequireTargetIdentity(t *testing.T) {
	app := newResourceGatewayFixture()

	errorCases := []struct {
		name    string
		call    func() error
		wantErr string
	}{
		{"deletePod namespace", func() error {
			return app.gateway.deletePodAction(objectActionTarget("cluster-a", "", "v1", "Pod", "", "pod"))
		}, "namespace is required"},
		{"deletePod name", func() error {
			return app.gateway.deletePodAction(objectActionTarget("cluster-a", "", "v1", "Pod", "ns", ""))
		}, "pod name is required"},
		{"PodContainers namespace", func() error { _, err := app.gateway.GetPodContainers("cluster-a", "", "pod"); return err }, "namespace is required"},
		{"PodContainers name", func() error { _, err := app.gateway.GetPodContainers("cluster-a", "ns", ""); return err }, "pod name is required"},
		{"Debug namespace", func() error {
			_, err := app.gateway.createDebugContainerAction(
				objectActionTarget("cluster-a", "", "v1", "Pod", "", "pod"),
				ObjectActionDebugContainerOptions{Image: "busybox"},
			)
			return err
		}, "namespace is required"},
		{"Debug name", func() error {
			_, err := app.gateway.createDebugContainerAction(
				objectActionTarget("cluster-a", "", "v1", "Pod", "ns", ""),
				ObjectActionDebugContainerOptions{Image: "busybox"},
			)
			return err
		}, "pod name is required"},
		{"HelmDelete namespace", func() error {
			return app.gateway.deleteHelmReleaseAction(objectActionTarget("cluster-a", "helm.sh", "v3", "HelmRelease", "", "release"))
		}, "namespace is required"},
		{"HelmDelete name", func() error {
			return app.gateway.deleteHelmReleaseAction(objectActionTarget("cluster-a", "helm.sh", "v3", "HelmRelease", "ns", ""))
		}, "name is required"},
		{"Cordon name", func() error {
			return app.gateway.cordonNodeAction(objectActionTarget("cluster-a", "", "v1", "Node", "", ""))
		}, "name is required"},
		{"Uncordon name", func() error {
			return app.gateway.uncordonNodeAction(objectActionTarget("cluster-a", "", "v1", "Node", "", ""))
		}, "name is required"},
		{"Drain name", func() error {
			return app.gateway.drainNodeAction(objectActionTarget("cluster-a", "", "v1", "Node", "", ""), DrainNodeOptions{})
		}, "name is required"},
		{"deleteNode name", func() error {
			return app.gateway.deleteNodeAction(objectActionTarget("cluster-a", "", "v1", "Node", "", ""), false)
		}, "name is required"},
		{"forceDeleteNode name", func() error {
			return app.gateway.deleteNodeAction(objectActionTarget("cluster-a", "", "v1", "Node", "", ""), true)
		}, "name is required"},
	}

	for _, tc := range errorCases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil {
				t.Fatalf("expected %q", tc.wantErr)
			}
			if err.Error() != tc.wantErr {
				t.Fatalf("expected %q, got %v", tc.wantErr, err)
			}
		})
	}

	if resp := app.gateway.DiscoverNodeLogs("cluster-a", ""); resp.Reason != "name is required" {
		t.Fatalf("expected DiscoverNodeLogs name error, got %+v", resp)
	}
	if _, err := app.gateway.FetchNodeLogs("cluster-a", "", NodeLogFetchRequest{SourcePath: "/var/log"}); err == nil || err.Error() != "name is required" {
		t.Fatalf("expected FetchNodeLogs name error, got %v", err)
	}
}

func TestNodeLogsRequireNodeProxyPermission(t *testing.T) {
	app := wrapperResourceGatewayFixture(t)
	clusterID := "config:ctx"
	client := cgofake.NewClientset()
	denySelfSubjectAccessReviews(client, "node proxy denied")
	app.clusters = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	discovery := app.gateway.DiscoverNodeLogs(clusterID, "node-a")
	if !strings.Contains(discovery.Reason, "node proxy denied") {
		t.Fatalf("expected node proxy denial, got %+v", discovery)
	}

	_, err := app.gateway.FetchNodeLogs(clusterID, "node-a", NodeLogFetchRequest{SourcePath: "journal/kubelet"})
	if err == nil || !strings.Contains(err.Error(), "node proxy denied") {
		t.Fatalf("expected node proxy denial, got %v", err)
	}
	if reason := errorstatus.Classify(err).Reason; reason != errorstatus.ReasonForbidden {
		t.Fatalf("expected a Forbidden status, got %s", reason)
	}
}
