/*
 * backend/app_lifecycle.go
 *
 * Manages the lifecycle of the backend application.
 */

package backend

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logclassify"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var newRefreshSubsystemWithServices = system.NewSubsystemWithServices
var (
	runtimeEventsEmit     = runtime.EventsEmit
	runtimeMessageDialog  = runtime.MessageDialog
	runtimeQuit           = runtime.Quit
	runtimeWindowSetSize  = runtime.WindowSetSize
	runtimeWindowSetPos   = runtime.WindowSetPosition
	runtimeWindowMaximise = runtime.WindowMaximise
	runtimeWindowShow     = runtime.WindowShow
)

// Startup is called when the app starts. The context passed is stored for later use.
func (a *App) Startup(ctx context.Context) {
	a.Ctx = ctx
	a.eventEmitter = runtimeEventsEmit
	a.clusterLifecycle = newClusterLifecycle(func(clusterId, state, previousState string) {
		a.emitEvent("cluster:lifecycle", map[string]string{
			"clusterId":     clusterId,
			"state":         state,
			"previousState": previousState,
		})
	})
	a.logger.Info("Application startup initiated", logsources.App)

	errorcapture.Init()
	errorcapture.SetEventEmitter(func(message string) {
		// Note: Auth state management is now per-cluster via transport wrappers.
		// Stderr errors don't have cluster context, so we only emit to frontend
		// for UI display. The per-cluster auth managers handle state based on
		// 401 responses, which DO have cluster context.
		// clusterId is empty here because stderr errors are not associated with
		// a specific cluster.
		a.emitEvent("backend-error", map[string]any{
			"clusterId": "",
			"message":   strings.TrimSpace(message),
			"source":    "stderr",
		})
	})
	errorcapture.SetLogSink(func(level string, message string) {
		// Suppress logging when ANY cluster has auth issues to prevent log spam.
		// Auth-related errors are already being handled by the per-cluster auth managers.
		if a.anyClusterAuthInvalid() {
			return
		}
		// Also suppress auth-related messages that match known patterns.
		// This provides belt-and-suspenders protection against timing issues
		// where auth errors arrive before state transitions complete.
		lower := strings.ToLower(message)
		if containsAuthPattern(lower) {
			return
		}
		switch level {
		case logclassify.LevelError:
			a.logger.Error(message, logsources.ErrorCapture)
		case logclassify.LevelWarn:
			a.logger.Warn(message, logsources.ErrorCapture)
		case logclassify.LevelDebug:
			a.logger.Debug(message, logsources.ErrorCapture)
		default:
			a.logger.Info(message, logsources.ErrorCapture)
		}
	})

	if err := a.checkBetaExpiry(); err != nil {
		a.logger.Error(err.Error(), logsources.App)
		runtimeMessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "Beta Version Expired",
			Message: err.Error(),
		})
		runtimeQuit(ctx)
		return
	}

	a.logger.SetEventEmitter(func(eventName string, args ...interface{}) {
		a.emitEvent(eventName, args...)
	})

	log.SetFlags(0)
	log.SetOutput(&stdLogBridge{logger: a.logger})

	a.setupEnvironment()
	a.logger.Debug("Environment setup completed", logsources.App)

	if settings, err := a.LoadWindowSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to load window settings: %v", err), logsources.App)
	} else if settings != nil {
		if settings.Width > 0 && settings.Height > 0 {
			runtimeWindowSetSize(ctx, settings.Width, settings.Height)
		}
		if settings.X >= 0 && settings.Y >= 0 {
			runtimeWindowSetPos(ctx, settings.X, settings.Y)
		}
		if settings.Maximized {
			runtimeWindowMaximise(ctx)
		}
	}

	runtimeWindowShow(ctx)
	a.logger.Info("Luxury Yacht - Sail the Seas of Kubernetes In Style", logsources.App)

	a.logger.Info("Discovering kubeconfig files...", logsources.App)
	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.Error(fmt.Sprintf("Failed to discover kubeconfigs: %v", err), logsources.App)
	} else {
		a.logger.Info(fmt.Sprintf("Found %d kubeconfig file(s)", len(a.availableKubeconfigs)), logsources.App)
	}

	// Startup is single-threaded here: the kubeconfig watcher has not started and
	// Wails RPC handlers are not yet dispatching, so loadAppSettings is safe
	// without settingsMu.
	if err := a.loadAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to load app settings: %v", err), logsources.App)
		a.appSettings = getDefaultAppSettings()
		a.logger.Info("Initialized app settings with defaults", logsources.App)
	} else {
		a.logger.Debug("Application settings loaded successfully", logsources.App)
	}

	a.restoreKubeconfigSelection()

	if len(a.selectedKubeconfigs) > 0 {
		a.logger.Info(fmt.Sprintf("Connecting to %d selected cluster(s)", len(a.selectedKubeconfigs)), logsources.App)
		if err := a.initKubernetesClient(); err != nil {
			a.logger.Error(fmt.Sprintf("Failed to connect to cluster(s): %v", err), logsources.App)
		} else {
			a.logger.Info("Successfully connected to Kubernetes cluster(s)", logsources.App)
		}
	} else {
		a.logger.Warn("No kubeconfig selections found - please select a cluster", logsources.App)
	}

	// Start watching kubeconfig directories after cluster initialization completes
	// so watcher callbacks cannot race startup subsystem construction.
	if err := a.startKubeconfigWatcher(); err != nil {
		a.logger.Warn(fmt.Sprintf("Kubeconfig directory watcher not available: %v", err), logsources.App)
	}

	// Per-cluster heartbeat runs via startHeartbeatLoop, launched by setupRefreshSubsystem.
	// Run update checks in the background so the UI can surface them on startup.
	a.startUpdateCheck()
}

type stdLogBridge struct {
	logger *Logger
}

func (b *stdLogBridge) Write(p []byte) (int, error) {
	if b == nil || b.logger == nil {
		return len(p), nil
	}

	lines := strings.Split(string(p), "\n")
	for _, line := range lines {
		msg := strings.TrimSpace(line)
		if msg == "" {
			continue
		}

		switch logclassify.Classify(msg) {
		case logclassify.LevelError:
			b.logger.Error(msg, logsources.StandardLog)
		case logclassify.LevelWarn:
			b.logger.Warn(msg, logsources.StandardLog)
		case logclassify.LevelDebug:
			b.logger.Debug(msg, logsources.StandardLog)
		default:
			b.logger.Info(msg, logsources.StandardLog)
		}
	}

	return len(p), nil
}

// NewBeforeCloseHandler runs while the window is still alive so window metrics can be read safely.
func NewBeforeCloseHandler(app *App) func(context.Context) bool {
	return func(ctx context.Context) bool {
		app.logger.Info("Application close requested", logsources.App)

		if err := app.SaveWindowSettings(); err != nil {
			app.logger.Warn(fmt.Sprintf("Failed to save window settings: %v", err), logsources.App)
		} else {
			app.logger.Debug("Window settings saved successfully", logsources.App)
		}

		return false
	}
}

// Shutdown is called when the app is about to close and the frontend has been torn down.
func (a *App) Shutdown(ctx context.Context) {
	a.logger.Info("Application shutdown initiated", logsources.App)

	// Shutdown all per-cluster auth managers to stop any recovery goroutines.
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil && clients.authManager != nil {
			clients.authManager.Shutdown()
		}
	}
	a.clusterClientsMu.Unlock()

	// Stop the kubeconfig directory watcher before tearing down cluster state.
	a.stopKubeconfigWatcher()

	a.teardownRefreshSubsystem()

	a.logger.Info("Application shutdown completed", logsources.App)
}

// anyClusterAuthInvalid returns true if any cluster has an auth state that is not Valid.
// Used to suppress auth error logging when we know auth issues exist.
func (a *App) anyClusterAuthInvalid() bool {
	if a == nil {
		return false
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	for _, clients := range a.clusterClients {
		if clients == nil || clients.authManager == nil {
			continue
		}
		if !clients.authManager.IsValid() {
			return true
		}
	}
	return false
}

// containsAuthPattern checks if a lowercased message contains auth-related patterns.
// Used to suppress auth error logging even if state hasn't transitioned yet.
func containsAuthPattern(lower string) bool {
	authPatterns := []string{
		"token",
		"sso",
		"expired",
		"authentication",
		"unauthorized",
		"forbidden",
		"permission denied",
		"access denied",
	}
	for _, pattern := range authPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}
