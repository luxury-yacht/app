package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
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

func TestAppTestingSetters(t *testing.T) {
	app := newTestAppWithDefaults(t)

	restCfg := &rest.Config{}
	metrics := &metricsclient.Clientset{}
	apiExt := &apiextensionsclientset.Clientset{}
	dyn := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())

	app.SetRestConfig(restCfg)
	app.SetMetricsClient(metrics)
	app.SetApiExtensionsClient(apiExt)
	app.SetDynamicClient(dyn)

	require.Equal(t, restCfg, app.restConfig)
	require.Equal(t, metrics, app.metricsClient)
	require.Equal(t, apiExt, app.apiextensionsClient)
	require.Equal(t, dyn, app.dynamicClient)
}
