package backend

import (
	"context"
	"net"
	"net/http"
	"sync"
	"time"

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
	Ctx                     context.Context
	client                  kubernetes.Interface
	apiextensionsClient     apiextensionsclientset.Interface
	dynamicClient           dynamic.Interface
	metricsClient           *metricsclient.Clientset
	restConfig              *rest.Config
	selectedKubeconfig      string
	selectedContext         string
	selectedKubeconfigs     []string
	availableKubeconfigs    []KubeconfigInfo
	windowSettings          *WindowSettings
	appSettings             *AppSettings
	logger                  *Logger
	versionCache            *versioning.Cache
	sidebarVisible          bool
	diagnosticsPanelVisible bool
	logsPanelVisible        bool

	refreshManager               *refresh.Manager
	refreshHTTPServer            *http.Server
	refreshListener              net.Listener
	refreshCancel                context.CancelFunc
	refreshBaseURL               string
	refreshServerDone            chan struct{}
	telemetryRecorder            *telemetry.Recorder
	sharedInformerFactory        informers.SharedInformerFactory
	apiExtensionsInformerFactory apiextinformers.SharedInformerFactory
	refreshSubsystems            map[string]*system.Subsystem

	objectCatalogMu      sync.Mutex
	objectCatalogEntries map[string]*objectCatalogEntry

	// persistenceMu guards persistence.json read/write operations.
	persistenceMu sync.Mutex

	permissionCacheMu sync.Mutex
	permissionCaches  map[string]map[string]bool

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

	listenLoopback func() (net.Listener, error)

	eventEmitter          func(context.Context, string, ...interface{})
	startAuthRecovery     func(string)
	kubeClientInitializer func() error
}

// NewApp constructs a backend App with sane defaults.
func NewApp() *App {
	app := &App{
		logger:               NewLogger(1000),
		versionCache:         versioning.NewCache(),
		sidebarVisible:       true,
		logsPanelVisible:     false,
		permissionCaches:     make(map[string]map[string]bool),
		refreshSubsystems:    make(map[string]*system.Subsystem),
		clusterClients:       make(map[string]*clusterClients),
		objectCatalogEntries: make(map[string]*objectCatalogEntry),
		shellSessions:        make(map[string]*shellSession),
		eventEmitter:         func(context.Context, string, ...interface{}) {},
	}
	app.startAuthRecovery = func(reason string) {
		go app.runAuthRecovery(reason)
	}
	app.kubeClientInitializer = func() error {
		return app.initKubernetesClient()
	}
	app.listenLoopback = defaultLoopbackListener
	app.setupEnvironment()
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

func (a *App) currentSelectionKey() string {
	meta := a.currentClusterMeta()
	if meta.ID != "" {
		return meta.ID
	}
	if a.selectedKubeconfig == "" {
		return ""
	}
	if a.selectedContext == "" {
		return a.selectedKubeconfig
	}
	return a.selectedKubeconfig + ":" + a.selectedContext
}

func (a *App) getPermissionCache(selection string) map[string]bool {
	if selection == "" {
		return nil
	}
	a.permissionCacheMu.Lock()
	defer a.permissionCacheMu.Unlock()
	cache := a.permissionCaches[selection]
	if cache == nil {
		return nil
	}
	cloned := make(map[string]bool, len(cache))
	for k, v := range cache {
		cloned[k] = v
	}
	return cloned
}

func (a *App) emitEvent(name string, args ...interface{}) {
	if a == nil || a.eventEmitter == nil || a.Ctx == nil {
		return
	}
	a.eventEmitter(a.Ctx, name, args...)
}

func (a *App) setPermissionCache(selection string, cache map[string]bool) {
	if selection == "" || cache == nil {
		return
	}
	a.permissionCacheMu.Lock()
	defer a.permissionCacheMu.Unlock()
	cloned := make(map[string]bool, len(cache))
	for k, v := range cache {
		cloned[k] = v
	}
	a.permissionCaches[selection] = cloned
}

func (a *App) clearPermissionCaches() {
	a.permissionCacheMu.Lock()
	defer a.permissionCacheMu.Unlock()
	a.permissionCaches = make(map[string]map[string]bool)
}
