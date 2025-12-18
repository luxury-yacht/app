package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func TestAppSettersAssignClients(t *testing.T) {
	app := NewApp()

	restCfg := &rest.Config{Host: "example"}
	app.SetRestConfig(restCfg)
	require.Equal(t, restCfg, app.restConfig)

	metricsClient := &metricsclient.Clientset{}
	app.SetMetricsClient(metricsClient)
	require.Equal(t, metricsClient, app.metricsClient)

	apiExt := &apiextensionsclientset.Clientset{}
	app.SetApiExtensionsClient(apiExt)
	require.Equal(t, apiExt, app.apiextensionsClient)

	dyn := fake.NewSimpleDynamicClient(runtime.NewScheme())
	app.SetDynamicClient(dyn)
	require.Equal(t, dyn, app.dynamicClient)
}
