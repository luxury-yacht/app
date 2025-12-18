package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"k8s.io/client-go/kubernetes"
)

func (a *App) setupRefreshSubsystem(kubeClient kubernetes.Interface, selectionKey string, permissionCache map[string]bool) (map[string]bool, error) {
	if kubeClient == nil {
		return nil, errors.New("kubernetes client is nil")
	}
	if a.Ctx == nil {
		return nil, errors.New("application context not initialised")
	}

	cfg := system.Config{
		KubernetesClient:      kubeClient,
		MetricsClient:         a.metricsClient,
		RestConfig:            a.restConfig,
		ResyncInterval:        config.RefreshResyncInterval,
		MetricsInterval:       config.RefreshMetricsInterval,
		APIExtensionsClient:   a.apiextensionsClient,
		DynamicClient:         a.dynamicClient,
		HelmFactory:           a.helmActionFactory(),
		ObjectDetailsProvider: a.objectDetailProvider(),
		Logger:                a.logger,
		PermissionCache:       permissionCache,
		ObjectCatalogService: func() *objectcatalog.Service {
			return a.objectCatalogService
		},
		ObjectCatalogEnabled: func() bool { return true },
	}

	manager, handler, recorder, issues, updatedCache, infFactory, err := newRefreshSubsystem(cfg)
	if err != nil {
		return nil, err
	}

	if a.listenLoopback == nil {
		a.listenLoopback = defaultLoopbackListener
	}

	listener, err := a.listenLoopback()
	if err != nil {
		return nil, err
	}

	srv := &http.Server{Handler: handler}
	ctx, cancel := context.WithCancel(a.Ctx)
	a.refreshCancel = cancel
	a.refreshManager = manager
	a.refreshHTTPServer = srv
	a.refreshListener = listener
	a.refreshBaseURL = "http://" + listener.Addr().String()
	a.telemetryRecorder = recorder
	a.refreshServerDone = make(chan struct{})
	if infFactory != nil {
		a.sharedInformerFactory = infFactory.SharedInformerFactory()
		a.apiExtensionsInformerFactory = infFactory.APIExtensionsInformerFactory()
	} else {
		a.sharedInformerFactory = nil
		a.apiExtensionsInformerFactory = nil
	}

	if len(issues) > 0 {
		a.handlePermissionIssues(issues)
	}

	go func() {
		if err := manager.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
			a.logger.Warn(fmt.Sprintf("refresh manager stopped: %v", err), "Refresh")
		}
	}()

	go func() {
		defer close(a.refreshServerDone)
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			a.logger.Warn(fmt.Sprintf("refresh HTTP server stopped: %v", err), "Refresh")
		}
	}()

	if updatedCache != nil && selectionKey != "" {
		a.setPermissionCache(selectionKey, updatedCache)
	}

	return updatedCache, nil
}

func (a *App) helmActionFactory() snapshot.HelmActionFactory {
	return func(namespace string) (*action.Configuration, error) {
		settings := cli.New()
		if a.selectedKubeconfig != "" {
			settings.KubeConfig = a.selectedKubeconfig
		}
		if a.selectedContext != "" {
			settings.KubeContext = a.selectedContext
		}

		actionConfig := new(action.Configuration)
		if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "secret", func(format string, v ...interface{}) {
			if a.logger != nil {
				a.logger.Debug(fmt.Sprintf(format, v...), "Helm")
			}
		}); err != nil {
			return nil, err
		}
		return actionConfig, nil
	}
}
