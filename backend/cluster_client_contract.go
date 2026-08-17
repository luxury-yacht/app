package backend

import (
	"context"
	"fmt"
	"runtime"

	appconfig "github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
)

// clusterClients stores Kubernetes clients scoped to a specific cluster selection.
type clusterClients struct {
	meta                   ClusterMeta
	kubeconfigPath         string
	kubeconfigContext      string
	client                 kubernetes.Interface
	gatewayClient          gatewayversioned.Interface
	gatewayInformerFactory gatewayinformers.SharedInformerFactory
	gatewayAPIPresence     common.GatewayAPIPresence
	gatewayVersionResolver common.VersionResolver
	apiextensionsClient    apiextensionsclientset.Interface
	dynamicClient          dynamic.Interface
	metricsClient          *metricsclient.Clientset
	restConfig             *rest.Config
	rateLimiter            *mutableKubernetesRateLimiter
	// authManager provides per-cluster auth state tracking and recovery.
	// Each cluster has its own auth manager so that auth failures in one
	// cluster don't affect other clusters.
	authManager *authstate.Manager
	// authFailedOnInit is true if the pre-flight credential check failed
	// during client initialization. Used to skip subsystem creation.
	authFailedOnInit bool
	// fallbackResourceResolver is used only before the object catalog service is
	// available. It avoids rebuilding the built-in identity seed on every
	// cold-start lookup.
	fallbackResourceResolver common.ResourceResolver
}

type builtClusterClientDependencies struct {
	client                 kubernetes.Interface
	gatewayClient          gatewayversioned.Interface
	gatewayInformerFactory gatewayinformers.SharedInformerFactory
	gatewayAPIPresence     *gatewayapi.Presence
	apiextensionsClient    apiextensionsclientset.Interface
	dynamicClient          dynamic.Interface
	metricsClient          *metricsclient.Clientset
}

type clusterClientBuilder func(
	context.Context,
	kubeconfigSelection,
	ClusterMeta,
) (*clusterClients, error)

type clusterClientCreateTask struct {
	selection kubeconfigSelection
	meta      ClusterMeta
}

type removedClusterClient struct {
	clusterID   string
	authManager interface{ Shutdown() }
}

func validateClusterClientSync(runtime workspaceClusterRuntime, ctx context.Context, build clusterClientBuilder) (context.Context, error) {
	if runtime == nil {
		return nil, fmt.Errorf("cluster runtime manager is nil")
	}
	if build == nil {
		return nil, fmt.Errorf("cluster client builder is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return ctx, nil
}

func shutdownClusterClientAuthManager(clients *clusterClients) {
	if clients != nil && clients.authManager != nil {
		clients.authManager.Shutdown()
	}
}

func clusterClientAuthManager(clients *clusterClients) interface{ Shutdown() } {
	if clients == nil || clients.authManager == nil {
		return nil
	}
	return clients.authManager
}

// clusterClientBuildConcurrencyLimit derives a bounded parallelism level for
// per-selection client initialization. Work is network-bound (discovery/auth).
func clusterClientBuildConcurrencyLimit(taskCount int) int {
	if taskCount <= 1 {
		return taskCount
	}
	limit := runtime.GOMAXPROCS(0)
	if limit <= 0 {
		limit = 1
	}
	if taskCount < limit {
		return taskCount
	}
	return limit
}

func shutdownClusterAuthManagerIfOwned(manager *authstate.Manager, owned bool) {
	if owned {
		manager.Shutdown()
	}
}

// configureClusterRecoveryTest rebuilds credentials rather than probing with a
// clientset that may still cache credentials from the failed request.
func configureClusterRecoveryTest(manager *authstate.Manager, selection kubeconfigSelection) {
	manager.SetRecoveryTest(func() error {
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		loadingRules.ExplicitPath = selection.Path
		overrides := &clientcmd.ConfigOverrides{}
		if selection.Context != "" {
			overrides.CurrentContext = selection.Context
		}
		clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
		freshConfig, err := clientConfig.ClientConfig()
		if err != nil {
			return fmt.Errorf("failed to load kubeconfig: %w", err)
		}
		freshConfig.Timeout = appconfig.ClusterAuthRecoveryProbeTimeout

		freshClient, err := kubernetes.NewForConfig(freshConfig)
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		_, err = freshClient.Discovery().ServerVersion()
		return err
	})
}

// classifyRecoveryError maps a recovery probe failure to an auth or
// connectivity verdict. Only errors proving the cluster rejected the
// credentials — an HTTP 401/403 or a failed exec credential plugin — are
// auth-class and consume recovery attempts. Everything else (connection
// refused, timeouts, DNS, TLS) means the cluster could not be reached, which
// says nothing about credential validity, so the recovery loop keeps probing.
func classifyRecoveryError(err error) authstate.ErrorClass {
	switch credentialerrors.Classify(err, credentialerrors.Context{}).Class {
	case credentialerrors.ClassAuth:
		return authstate.ErrorClassAuth
	case credentialerrors.ClassConnectivity:
		return authstate.ErrorClassConnectivity
	default:
		return authstate.ErrorClassUnknown
	}
}

// buildRestConfigForSelection loads a REST config for the provided kubeconfig path/context.
// The clusterAuthMgr parameter is the per-cluster auth manager that will be used to wrap
// protobufRestConfig returns a COPY of base that negotiates Protobuf for built-in
// kinds: the Accept header offers protobuf-then-JSON, so the server picks protobuf
// where it can (every conformant apiserver serves it for built-ins — the control
// plane itself speaks it) and answers JSON where it cannot (third-party aggregated
// APIs) — the fallback is byte-for-byte the old behavior. Copying keeps the shared
// base config pristine for the dynamic and gateway clients, whose custom resources
// are JSON-only.
func protobufRestConfig(base *rest.Config) *rest.Config {
	cfg := rest.CopyConfig(base)
	cfg.AcceptContentTypes = "application/vnd.kubernetes.protobuf,application/json"
	cfg.ContentType = "application/vnd.kubernetes.protobuf"
	return cfg
}
