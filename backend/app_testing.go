/*
 * backend/app_testing.go
*
 * Tests for application testing functionality.
*/

package backend

import (
	"context"
	"fmt"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func (a *App) InitializeForTesting(ctx context.Context, client kubernetes.Interface) {
	a.Ctx = ctx
	a.client = client
	if a.logger == nil {
		a.logger = NewLogger(1000)
	}
	if client != nil {
		if err := a.setupRefreshSubsystem(client, a.currentSelectionKey()); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to initialize refresh subsystem in tests: %v", err), "Refresh")
		} else {
			a.startObjectCatalog()
		}
	}
}

func (a *App) SetRestConfig(config *rest.Config) {
	a.restConfig = config
}

func (a *App) SetMetricsClient(client *metricsclient.Clientset) {
	a.metricsClient = client
}

func (a *App) SetApiExtensionsClient(client *apiextensionsclientset.Clientset) {
	a.apiextensionsClient = client
}

func (a *App) SetDynamicClient(client dynamic.Interface) {
	a.dynamicClient = client
}
