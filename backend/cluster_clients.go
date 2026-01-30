package backend

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/luxury-yacht/app/backend/internal/authstate"
)

// clusterClients stores Kubernetes clients scoped to a specific cluster selection.
type clusterClients struct {
	meta                ClusterMeta
	kubeconfigPath      string
	kubeconfigContext   string
	client              kubernetes.Interface
	apiextensionsClient apiextensionsclientset.Interface
	dynamicClient       dynamic.Interface
	metricsClient       *metricsclient.Clientset
	restConfig          *rest.Config
	// authManager provides per-cluster auth state tracking and recovery.
	// Each cluster has its own auth manager so that auth failures in one
	// cluster don't affect other clusters.
	authManager *authstate.Manager
	// authFailedOnInit is true if the pre-flight credential check failed
	// during client initialization. Used to skip subsystem creation.
	authFailedOnInit bool
}

func (a *App) clusterClientsForID(clusterID string) *clusterClients {
	if a == nil || clusterID == "" {
		return nil
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	return a.clusterClients[clusterID]
}

// syncClusterClientPool builds missing clients for the provided selections and drops stale entries.
func (a *App) syncClusterClientPool(selections []kubeconfigSelection) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}

	desired := make(map[string]kubeconfigSelection, len(selections))
	for _, sel := range selections {
		meta := a.clusterMetaForSelection(sel)
		if meta.ID == "" {
			continue
		}
		desired[meta.ID] = sel
	}

	var toCreate []kubeconfigSelection

	a.clusterClientsMu.Lock()
	if a.clusterClients == nil {
		a.clusterClients = make(map[string]*clusterClients)
	}
	for id, selection := range desired {
		if _, exists := a.clusterClients[id]; !exists {
			toCreate = append(toCreate, selection)
		}
	}
	a.clusterClientsMu.Unlock()

	for _, sel := range toCreate {
		meta := a.clusterMetaForSelection(sel)
		if meta.ID == "" {
			continue
		}
		clients, err := a.buildClusterClients(sel, meta)
		if err != nil {
			return err
		}

		a.clusterClientsMu.Lock()
		a.clusterClients[meta.ID] = clients
		a.clusterClientsMu.Unlock()
	}

	a.clusterClientsMu.Lock()
	for id, clients := range a.clusterClients {
		if _, ok := desired[id]; !ok {
			// Shutdown the auth manager for removed clusters
			if clients != nil && clients.authManager != nil {
				clients.authManager.Shutdown()
			}
			delete(a.clusterClients, id)
		}
	}
	a.clusterClientsMu.Unlock()

	return nil
}

// buildClusterClients initializes client-go dependencies for a specific kubeconfig selection.
func (a *App) buildClusterClients(selection kubeconfigSelection, meta ClusterMeta) (*clusterClients, error) {
	// Create a per-cluster auth manager. This ensures auth failures in one cluster
	// don't affect other clusters.
	clusterAuthMgr := a.createClusterAuthManager(meta)

	config, err := a.buildRestConfigForSelection(selection, clusterAuthMgr)
	if err != nil {
		clusterAuthMgr.Shutdown()
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		clusterAuthMgr.Shutdown()
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	apiextensionsClient, err := apiextensionsclientset.NewForConfig(config)
	if err != nil {
		clusterAuthMgr.Shutdown()
		return nil, fmt.Errorf("failed to create apiextensions clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		clusterAuthMgr.Shutdown()
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	var metrics *metricsclient.Clientset
	metricsClient, err := metricsclient.NewForConfig(config)
	if err != nil {
		if a.logger != nil {
			a.logger.Info(fmt.Sprintf("Metrics client not available for cluster %s: %v", meta.ID, err), "KubernetesClient")
		}
	} else {
		metrics = metricsClient
	}

	// Configure the recovery test now that we have the clientset.
	// This allows the auth manager to test connectivity for THIS specific cluster.
	clusterAuthMgr.SetRecoveryTest(func() error {
		_, err := clientset.Discovery().ServerVersion()
		return err
	})

	// Pre-flight credential check: test connectivity before returning.
	// This triggers auth state transition BEFORE the informer factory tries to make requests.
	// The exec credential provider runs at this layer (above HTTP transport), so transport
	// wrapper won't catch these errors - we must check them explicitly here.
	var authFailedOnInit bool
	if _, err := clientset.Discovery().ServerVersion(); err != nil {
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Pre-flight check failed for cluster %s: %v", meta.Name, err), "Auth")
		}
		if isCredentialError(err) {
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Detected credential error for cluster %s, reporting auth failure", meta.Name), "Auth")
			}
			clusterAuthMgr.ReportFailure(err.Error())
			authFailedOnInit = true
		}
		// Don't return error - the cluster clients are valid, auth just needs recovery.
		// The subsystem builder will check auth state before proceeding.
	} else {
		if a.logger != nil {
			a.logger.Info(fmt.Sprintf("Pre-flight check passed for cluster %s", meta.Name), "Auth")
		}
	}

	return &clusterClients{
		meta:                meta,
		kubeconfigPath:      selection.Path,
		kubeconfigContext:   selection.Context,
		client:              clientset,
		apiextensionsClient: apiextensionsClient,
		dynamicClient:       dynamicClient,
		metricsClient:       metrics,
		restConfig:          config,
		authManager:         clusterAuthMgr,
		authFailedOnInit:    authFailedOnInit,
	}, nil
}

// createClusterAuthManager creates a new auth state manager for a specific cluster.
func (a *App) createClusterAuthManager(meta ClusterMeta) *authstate.Manager {
	return authstate.New(authstate.Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second},
		OnStateChange: func(state authstate.State, reason string) {
			a.handleClusterAuthStateChange(meta.ID, state, reason)
		},
		// RecoveryTest is set later once we have the clientset
	})
}

// buildRestConfigForSelection loads a REST config for the provided kubeconfig path/context.
// The clusterAuthMgr parameter is the per-cluster auth manager that will be used to wrap
// the transport for auth state tracking.
func (a *App) buildRestConfigForSelection(selection kubeconfigSelection, clusterAuthMgr *authstate.Manager) (*rest.Config, error) {
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	loadingRules.ExplicitPath = selection.Path
	overrides := &clientcmd.ConfigOverrides{}
	if selection.Context != "" {
		overrides.CurrentContext = selection.Context
	}

	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to build config from %s: %w", selection.Path, err)
	}

	if config != nil && config.ExecProvider != nil {
		wrapExecProviderForWindows(config)
	}

	config.QPS = 500
	config.Burst = 1000

	// Wrap transport with auth-aware layer for per-cluster auth state management.
	// This intercepts 401 responses and reports them to the cluster's auth manager,
	// ensuring auth failures in one cluster don't affect other clusters.
	if clusterAuthMgr != nil {
		existingWrap := config.WrapTransport
		config.WrapTransport = func(rt http.RoundTripper) http.RoundTripper {
			if existingWrap != nil {
				rt = existingWrap(rt)
			}
			return clusterAuthMgr.WrapTransport(rt)
		}
	}

	return config, nil
}

// isCredentialError checks if an error indicates a credential/auth failure.
// This catches exec credential provider failures (like AWS SSO) that happen
// before an HTTP request is made.
func isCredentialError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	// Patterns that indicate credential/auth failures from exec providers
	credentialPatterns := []string{
		"getting credentials",
		"exec: executable",
		"failed with exit code",
		"token has expired",
		"token is expired",
		"sso session",
		"refresh token",
		"authentication required",
		"unauthorized",
		"access denied",
		"permission denied",
	}
	for _, pattern := range credentialPatterns {
		if strings.Contains(errStr, pattern) {
			return true
		}
	}
	return false
}
