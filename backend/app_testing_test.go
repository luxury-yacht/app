package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func TestInitializeForTestingSetsContextAndLogger(t *testing.T) {
	app := &App{}
	ctx := context.Background()

	app.InitializeForTesting(ctx, nil)

	require.Equal(t, ctx, app.Ctx)
	require.NotNil(t, app.logger)
}

// TestAppTestingSettersUpdateClusterClients verifies that the setter methods
// update the per-cluster clients rather than global fields (which no longer exist).
func TestAppTestingSettersUpdateClusterClients(t *testing.T) {
	app := newTestAppWithDefaults(t)

	// Initialize with a test client to create a cluster entry
	fakeClient := cgofake.NewClientset()
	app.InitializeForTesting(context.Background(), fakeClient)

	// Now set additional clients
	restCfg := &rest.Config{}
	metrics := &metricsclient.Clientset{}
	apiExt := &apiextensionsclientset.Clientset{}
	dyn := fake.NewSimpleDynamicClient(runtime.NewScheme())

	app.SetRestConfig(restCfg)
	app.SetMetricsClient(metrics)
	app.SetApiExtensionsClient(apiExt)
	app.SetDynamicClient(dyn)

	// Verify the cluster clients were updated
	require.NotEmpty(t, app.clusterClients)
	for _, clients := range app.clusterClients {
		require.Equal(t, restCfg, clients.restConfig)
		require.Equal(t, metrics, clients.metricsClient)
		require.Equal(t, apiExt, clients.apiextensionsClient)
		require.Equal(t, dyn, clients.dynamicClient)
	}
}

// TestAppSettersAssignToAllClusterClients verifies that setter methods
// update all cluster clients, not just a single one.
func TestAppSettersAssignToAllClusterClients(t *testing.T) {
	app := NewApp()
	app.clusterClients = map[string]*clusterClients{
		"cluster-1": {
			meta:   ClusterMeta{ID: "cluster-1", Name: "Cluster 1"},
			client: cgofake.NewClientset(),
		},
		"cluster-2": {
			meta:   ClusterMeta{ID: "cluster-2", Name: "Cluster 2"},
			client: cgofake.NewClientset(),
		},
	}

	restCfg := &rest.Config{Host: "example"}
	app.SetRestConfig(restCfg)
	for id, clients := range app.clusterClients {
		require.Equal(t, restCfg, clients.restConfig, "cluster %s should have restConfig set", id)
	}

	metricsClient := &metricsclient.Clientset{}
	app.SetMetricsClient(metricsClient)
	for id, clients := range app.clusterClients {
		require.Equal(t, metricsClient, clients.metricsClient, "cluster %s should have metricsClient set", id)
	}

	apiExt := &apiextensionsclientset.Clientset{}
	app.SetApiExtensionsClient(apiExt)
	for id, clients := range app.clusterClients {
		require.Equal(t, apiExt, clients.apiextensionsClient, "cluster %s should have apiextensionsClient set", id)
	}

	dyn := fake.NewSimpleDynamicClient(runtime.NewScheme())
	app.SetDynamicClient(dyn)
	for id, clients := range app.clusterClients {
		require.Equal(t, dyn, clients.dynamicClient, "cluster %s should have dynamicClient set", id)
	}
}
