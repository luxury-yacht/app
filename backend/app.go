package backend

import (
	"context"
	"net"
	"net/http"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/versioning"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	informers "k8s.io/client-go/informers"
)

var defaultLoopbackListener = func() (net.Listener, error) {
	return net.Listen("tcp", "127.0.0.1:0")
}

// App provides the backend façade exposed to Wails.
type App struct {
	Ctx                  context.Context
	selectedKubeconfigs  []string
	availableKubeconfigs []KubeconfigInfo
	windowSettings       *WindowSettings
	appSettings          *AppSettings
	logger               *Logger
	versionCache         *versioning.Cache
	// responseCache stores short-lived detail/YAML/helm GET responses.
	responseCache           *responseCache
	sidebarVisible            bool
	diagnosticsPanelVisible   bool
	logsPanelVisible          bool
	portForwardsPanelVisible  bool

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

	portForwardSessions   map[string]*portForwardSessionInternal
	portForwardSessionsMu sync.Mutex

	updateCheckOnce sync.Once
	updateCheckMu   sync.RWMutex
	updateInfo      *UpdateInfo

	// Per-cluster auth recovery scheduling.
	// Tracks auth recovery scheduling per-cluster, allowing isolated
	// recovery scheduling without affecting other clusters.
	clusterAuthRecoveryMu        sync.Mutex
	clusterAuthRecoveryScheduled map[string]bool

	// Per-cluster transport failure tracking.
	// Tracks transport failures per-cluster, allowing isolated
	// recovery without affecting other clusters.
	transportStatesMu sync.RWMutex
	transportStates   map[string]*transportFailureState

	listenLoopback func() (net.Listener, error)

	eventEmitter          func(context.Context, string, ...interface{})
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
		portForwardSessions:      make(map[string]*portForwardSessionInternal),
		eventEmitter:             func(context.Context, string, ...interface{}) {},
	}
	app.kubeClientInitializer = func() error {
		return app.initKubernetesClient()
	}
	app.listenLoopback = defaultLoopbackListener
	app.setupEnvironment()
	app.initAuthManager()
	return app
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
