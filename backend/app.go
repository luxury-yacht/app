package backend

import (
	"context"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/versioning"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/client-go/dynamic"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

var defaultLoopbackListener = func() (net.Listener, error) {
	return net.Listen("tcp", "127.0.0.1:0")
}

// App provides the backend façade exposed to Wails.
type App struct {
	Ctx                  context.Context
	client               kubernetes.Interface
	apiextensionsClient  apiextensionsclientset.Interface
	dynamicClient        dynamic.Interface
	metricsClient        *metricsclient.Clientset
	restConfig          *rest.Config
	selectedKubeconfigs []string
	availableKubeconfigs []KubeconfigInfo
	windowSettings       *WindowSettings
	appSettings          *AppSettings
	logger               *Logger
	versionCache         *versioning.Cache
	// responseCache stores short-lived detail/YAML/helm GET responses.
	responseCache           *responseCache
	sidebarVisible          bool
	diagnosticsPanelVisible bool
	logsPanelVisible        bool

	refreshManager               *refresh.Manager
	refreshHTTPServer            *http.Server
	refreshListener              net.Listener
	refreshCtx                   context.Context
	refreshCancel                context.CancelFunc
	refreshBaseURL               string
	refreshServerDone            chan struct{}
	telemetryRecorder            *telemetry.Recorder
	sharedInformerFactory        informers.SharedInformerFactory
	apiExtensionsInformerFactory apiextinformers.SharedInformerFactory
	refreshSubsystems            map[string]*system.Subsystem
	refreshAggregates            *refreshAggregateHandlers
	refreshPermissionCancels     map[string]context.CancelFunc

	objectCatalogMu      sync.Mutex
	objectCatalogEntries map[string]*objectCatalogEntry

	// persistenceMu guards persistence.json read/write operations.
	persistenceMu sync.Mutex

	clusterClientsMu sync.Mutex
	clusterClients   map[string]*clusterClients

	shellSessions   map[string]*shellSession
	shellSessionsMu sync.Mutex

	updateCheckOnce sync.Once
	updateCheckMu   sync.RWMutex
	updateInfo      *UpdateInfo

	authRecoveryMu        sync.Mutex
	authRecoveryScheduled bool

	transportMu                sync.Mutex
	transportFailureCount      int
	transportWindowStart       time.Time
	transportRebuildInProgress bool
	lastTransportRebuild       time.Time

	connectionStatusMu        sync.Mutex
	connectionStatus          ConnectionState
	connectionStatusMessage   string
	connectionStatusNextRetry int64
	connectionStatusUpdatedAt int64

	// authManager is deprecated. Auth state tracking is now per-cluster.
	// See clusterClients.authManager for per-cluster auth state management.
	// This field is kept for backwards compatibility but is no longer used.
	authManager *authstate.Manager

	listenLoopback func() (net.Listener, error)

	eventEmitter          func(context.Context, string, ...interface{})
	startAuthRecovery     func(string)
	kubeClientInitializer func() error
}

// NewApp constructs a backend App with sane defaults.
func NewApp() *App {
	app := &App{
		logger:                   NewLogger(1000),
		versionCache:             versioning.NewCache(),
		responseCache:            newDefaultResponseCache(),
		sidebarVisible:           true,
		logsPanelVisible:         false,
		refreshSubsystems:        make(map[string]*system.Subsystem),
		refreshPermissionCancels: make(map[string]context.CancelFunc),
		clusterClients:           make(map[string]*clusterClients),
		objectCatalogEntries:     make(map[string]*objectCatalogEntry),
		shellSessions:            make(map[string]*shellSession),
		eventEmitter:             func(context.Context, string, ...interface{}) {},
	}
	app.startAuthRecovery = func(reason string) {
		go app.runAuthRecovery(reason)
	}
	app.kubeClientInitializer = func() error {
		return app.initKubernetesClient()
	}
	app.listenLoopback = defaultLoopbackListener
	app.setupEnvironment()
	app.initAuthManager()
	app.connectionStatus = ConnectionStateHealthy
	app.connectionStatusMessage = connectionStateDefinitions[ConnectionStateHealthy].DefaultMessage
	return app
}

func (a *App) initKubeClient() error {
	if a.kubeClientInitializer != nil {
		return a.kubeClientInitializer()
	}
	return a.initKubernetesClient()
}

func (a *App) emitEvent(name string, args ...interface{}) {
	if a == nil || a.eventEmitter == nil || a.Ctx == nil {
		return
	}
	a.eventEmitter(a.Ctx, name, args...)
}

// initAuthManager is kept for backwards compatibility but is now a no-op.
// Auth state management is now per-cluster, handled by each cluster's authManager
// in the clusterClients struct. See cluster_auth.go for details.
func (a *App) initAuthManager() {
	// Per-cluster auth managers are created in buildClusterClients().
	// This function is kept for compatibility but does nothing.
}

// handleAuthStateChange is deprecated in favor of per-cluster auth state handling.
// See handleClusterAuthStateChange in cluster_auth.go.
// This is kept for backwards compatibility with any code that still references it.
func (a *App) handleAuthStateChange(_ authstate.State, _ string) {
	// Per-cluster auth state changes are handled by handleClusterAuthStateChange.
	// This function is kept for compatibility but delegates to aggregate status update.
	a.updateAggregateConnectionStatus()
}

// RetryAuth triggers a manual authentication recovery attempt for ALL clusters.
// Called when user clicks "Retry" after re-authenticating externally.
// For per-cluster retry, use RetryClusterAuth instead.
func (a *App) RetryAuth() {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	for _, clients := range a.clusterClients {
		if clients != nil && clients.authManager != nil {
			clients.authManager.TriggerRetry()
		}
	}
}
