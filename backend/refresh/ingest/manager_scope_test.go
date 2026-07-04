package ingest

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var clusterRoleGVR = schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}

// Namespace-scoped ingestion end-to-end (docs/plans/namespace-scope.md): a
// scoped manager runs one reflector per configured namespace through the
// production LIST/WATCH path and converges each kind's shared store on
// exactly the scope's objects.

func TestScopedIngestManagerFansReflectorsPerNamespace(t *testing.T) {
	server := newTrackerAPIServer(t)
	server.add(t, newCM("prod", "in-prod"), configMapGVK)
	server.add(t, newCM("dev", "in-dev"), configMapGVK)
	server.add(t, newCM("other", "outside-scope"), configMapGVK)

	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

	mgr := NewIngestManager(testMeta, kube, nil, nil, "prod", "dev")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	cmStore := mgr.StoreFor(configMapGVR)
	require.NotNil(t, cmStore)
	got := waitForNames(t, cmStore, []string{"dev/in-dev", "prod/in-prod"})
	require.ElementsMatch(t, []string{"dev/in-dev", "prod/in-prod"}, got,
		"scoped store must hold exactly the configured namespaces' objects")
}

func TestScopedIngestPartitionNamespaces(t *testing.T) {
	server := newTrackerAPIServer(t)
	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

	mgr := NewIngestManager(testMeta, kube, nil, nil, "prod", "dev")

	require.Equal(t, []string{"prod", "dev"}, mgr.partitionNamespaces(configMapGVR),
		"namespaced kinds fan out over the scope")
	require.Equal(t, []string{""}, mgr.partitionNamespaces(clusterRoleGVR),
		"cluster-scoped kinds keep the single cluster-wide reflector")

	unscoped := NewIngestManager(testMeta, kube, nil, nil)
	require.Equal(t, []string{""}, unscoped.partitionNamespaces(configMapGVR),
		"no scope degenerates to today's single reflector")
}

func TestScopedIngestPermissionSkipsOnlyDeniedNamespaces(t *testing.T) {
	server := newTrackerAPIServer(t)
	server.add(t, newCM("prod", "in-prod"), configMapGVK)
	server.add(t, newCM("dev", "in-dev"), configMapGVK)

	httpSrv := httptest.NewServer(server)
	defer httpSrv.Close()
	kube := newKubeClientFor(t, httpSrv)

	mgr := NewIngestManager(testMeta, kube, nil, nil, "prod", "dev")
	mgr.SetPermissionFilter(func(_, _, namespace string) bool {
		return namespace != "prod" // prod denied, dev (and cluster-wide "") allowed
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)
	waitForManagerSynced(t, mgr)

	cmStore := mgr.StoreFor(configMapGVR)
	require.NotNil(t, cmStore)
	got := waitForNames(t, cmStore, []string{"dev/in-dev"})
	require.ElementsMatch(t, []string{"dev/in-dev"}, got,
		"one denied namespace must not blank the allowed ones")
	require.False(t, mgr.PermissionSkippedFor(configMapGVR),
		"a kind with at least one running partition is not permission-skipped")
}
