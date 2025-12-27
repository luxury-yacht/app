package backend

import (
	"fmt"
	"path/filepath"
	"strings"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func (a *App) initKubernetesClient() (err error) {
	a.logger.Info("Initializing Kubernetes client", "KubernetesClient")
	defer func() {
		if err != nil {
			a.updateConnectionStatus(ConnectionStateOffline, err.Error(), 0)
		}
	}()

	if a.client != nil {
		a.logger.Debug("Kubernetes client already initialized, skipping", "KubernetesClient")
		return nil
	}

	var config *rest.Config

	a.logger.Debug("Attempting in-cluster Kubernetes configuration", "KubernetesClient")
	config, err = rest.InClusterConfig()
	if err != nil {
		a.logger.Debug("In-cluster config not available, using kubeconfig file", "KubernetesClient")
		kubeconfigPath := a.selectedKubeconfig
		if kubeconfigPath == "" {
			if home := homedir.HomeDir(); home != "" {
				kubeconfigPath = filepath.Join(home, ".kube", "config")
				a.logger.Debug("Using default kubeconfig location", "KubernetesClient")
			}
		} else {
			a.logger.Info(fmt.Sprintf("Using selected kubeconfig: %s", kubeconfigPath), "KubernetesClient")
		}

		if kubeconfigPath == "" {
			a.logger.Error("No kubeconfig available - cannot connect to Kubernetes", "KubernetesClient")
			return fmt.Errorf("no kubeconfig available")
		}

		if a.selectedContext != "" {
			a.logger.Info(fmt.Sprintf("Using Kubernetes context: %s", a.selectedContext), "KubernetesClient")
			loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
			loadingRules.ExplicitPath = kubeconfigPath
			overrides := &clientcmd.ConfigOverrides{CurrentContext: a.selectedContext}
			clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
			config, err = clientConfig.ClientConfig()
		} else {
			a.logger.Debug("Using default context from kubeconfig", "KubernetesClient")
			config, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
		}
		if err != nil {
			a.logger.Error(fmt.Sprintf("Failed to build config from %s: %v", kubeconfigPath, err), "KubernetesClient")
			return fmt.Errorf("failed to build config from %s: %w", kubeconfigPath, err)
		}
		a.logger.Info(fmt.Sprintf("Successfully loaded kubeconfig from %s", kubeconfigPath), "KubernetesClient")

		if config != nil && config.ExecProvider != nil {
			a.logger.Info(fmt.Sprintf("Using exec auth provider: %s", config.ExecProvider.Command), "KubernetesClient")
			// Windows exec helpers can flash a console; wrap them to run hidden.
			wrapExecProviderForWindows(config)
		}
	}

	config.QPS = 500
	config.Burst = 1000
	a.logger.Debug(fmt.Sprintf("Set Kubernetes client rate limits: QPS=%v, Burst=%v", config.QPS, config.Burst), "KubernetesClient")

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to create Kubernetes clientset: %v", err), "KubernetesClient")
		return fmt.Errorf("failed to create clientset: %w", err)
	}

	apiextensionsClient, err := apiextensionsclientset.NewForConfig(config)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to create API extensions clientset: %v", err), "KubernetesClient")
		return fmt.Errorf("failed to create apiextensions clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to create dynamic client: %v", err), "KubernetesClient")
		return fmt.Errorf("failed to create dynamic client: %w", err)
	}

	a.client = clientset
	a.apiextensionsClient = apiextensionsClient
	a.dynamicClient = dynamicClient
	a.restConfig = config

	// Keep the client pool aligned with the active kubeconfig selection.
	a.registerPrimaryClusterClient()

	selectionKey := a.currentSelectionKey()
	existingCache := a.getPermissionCache(selectionKey)
	_, err = a.setupRefreshSubsystem(clientset, selectionKey, existingCache)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to initialise refresh subsystem: %v", err), "Refresh")
		a.client = nil
		a.apiextensionsClient = nil
		a.dynamicClient = nil
		a.restConfig = nil
		return fmt.Errorf("failed to initialise refresh subsystem: %w", err)
	}

	a.startObjectCatalog()

	if a.metricsClient == nil {
		metricsClient, err := metricsclient.NewForConfig(config)
		if err != nil {
			a.logger.Info(fmt.Sprintf("Metrics client not available: %v", err), "KubernetesClient")
		} else {
			a.metricsClient = metricsClient
			a.logger.Info("Metrics client created successfully", "KubernetesClient")
		}
	}

	if config.Host != "" {
		a.logger.Info(fmt.Sprintf("Successfully connected to Kubernetes API server: %s", config.Host), "KubernetesClient")
	} else {
		a.logger.Info("Successfully established Kubernetes client connections", "KubernetesClient")
	}
	a.updateConnectionStatus(ConnectionStateHealthy, "", 0)

	return nil
}

func (a *App) restoreKubeconfigSelection() {
	// Prefer multi-selection settings when available, then fall back to legacy single selection.
	if a.appSettings != nil && len(a.appSettings.SelectedKubeconfigs) > 0 {
		normalized := make([]string, 0, len(a.appSettings.SelectedKubeconfigs))
		for _, selection := range a.appSettings.SelectedKubeconfigs {
			parsed, err := a.normalizeKubeconfigSelection(selection)
			if err != nil {
				continue
			}
			if err := a.validateKubeconfigSelection(parsed); err != nil {
				continue
			}
			normalized = append(normalized, parsed.String())
		}
		if len(normalized) > 0 {
			primary, err := parseKubeconfigSelection(normalized[0])
			if err == nil {
				a.selectedKubeconfigs = normalized
				a.selectedKubeconfig = primary.Path
				a.selectedContext = primary.Context
				return
			}
		}
	}

	if a.appSettings != nil && a.appSettings.SelectedKubeconfig != "" {
		parts := strings.SplitN(a.appSettings.SelectedKubeconfig, ":", 2)
		savedPath := parts[0]
		savedContext := ""
		if len(parts) == 2 {
			savedContext = parts[1]
		}

		for _, kc := range a.availableKubeconfigs {
			if kc.Path == savedPath && (savedContext == "" || kc.Context == savedContext) {
				a.selectedKubeconfig = savedPath
				a.selectedContext = kc.Context
				break
			}
		}
	}

	if a.selectedKubeconfig == "" && len(a.availableKubeconfigs) > 0 {
		for _, kc := range a.availableKubeconfigs {
			if kc.IsDefault && kc.IsCurrentContext {
				a.selectedKubeconfig = kc.Path
				a.selectedContext = kc.Context
				break
			}
		}
		if a.selectedKubeconfig == "" {
			for _, kc := range a.availableKubeconfigs {
				if kc.IsDefault {
					a.selectedKubeconfig = kc.Path
					a.selectedContext = kc.Context
					break
				}
			}
		}
		if a.selectedKubeconfig == "" {
			a.selectedKubeconfig = a.availableKubeconfigs[0].Path
			a.selectedContext = a.availableKubeconfigs[0].Context
		}
	}

	if a.selectedKubeconfig != "" {
		a.selectedKubeconfigs = []string{a.GetSelectedKubeconfig()}
	}
}
