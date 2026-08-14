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
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logclassify"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var newRefreshSubsystemWithServices = system.NewSubsystemWithServices

const beforeCloseSelectionFlushTimeout = 2 * time.Second

// ServiceStartup performs bounded, non-UI process initialization before native
// windows start. Interactive startup waits for WindowRuntimeReady.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.setApplicationContext(ctx)
	a.initializeClusterLifecycle()
	a.logger.Info("Application startup initiated", logsources.App)
	a.startDiagnosticDumpHandler(ctx)
	a.configureStartupErrorCapture()
	a.configureStartupLogging()
	a.setupEnvironment()
	a.logger.Debug("Environment setup completed", logsources.App)
	return nil
}

// WindowRuntimeReady runs interactive initialization once the webview runtime
// can receive events and JavaScript without dropping or merely queueing them.
func (a *App) WindowRuntimeReady(windowName string, restoreGeometry bool) bool {
	firstReadyWindow := a.markRuntimeReady()
	if firstReadyWindow && !a.checkStartupBetaExpiry(windowName) {
		return true
	}
	if restoreGeometry {
		a.restoreStartupWindow(windowName)
	}
	if window, err := a.workspaceWindow(windowName); err == nil {
		window.Show()
	}
	if !firstReadyWindow {
		return false
	}
	a.logger.Info("Luxury Yacht - Sail the Seas of Kubernetes In Style", logsources.App)
	a.initializeStartupClusters()
	if err := a.startKubeconfigWatcher(); err != nil {
		a.logger.Warn(fmt.Sprintf("Kubeconfig directory watcher not available: %v", err), logsources.App)
	}
	if a.applicationUpdates != nil {
		a.applicationUpdates.RuntimeReady()
	}
	a.scheduleInstallationMetricRegistration(a.CtxOrBackground())
	return true
}

func (a *App) initializeClusterLifecycle() {
	lifecycle := newClusterLifecycle(func(clusterID string, state, previousState ClusterLifecycleState) {
		// The wire payload is stringly (Wails flattens defined string types);
		// the frontend re-closes the union at its ingestion boundary. An empty
		// previousState means "no previous state" (first transition).
		a.emitEvent("cluster:lifecycle", map[string]string{
			"clusterId":     clusterID,
			"state":         string(state),
			"previousState": string(previousState),
		})
	})
	lifecycle.setSnapshotChangeObserver(a.markClusterWorkspaceChanged)
	a.clusterLifecycle = lifecycle
}

func (a *App) configureStartupErrorCapture() {
	errorcapture.Init()
	errorcapture.InstallUnhandledErrorDedup()
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
	errorcapture.SetLogSink(func(level, message string) {
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
}

func (a *App) checkStartupBetaExpiry(windowName string) bool {
	if err := a.checkBetaExpiry(); err != nil {
		applog.ReportError(a.logger, err, "Beta version expired", logsources.App)
		if a.wailsApplication != nil {
			dialog := a.wailsApplication.Dialog.Error().SetTitle("Beta Version Expired").SetMessage(err.Error())
			if window, windowErr := a.workspaceWindow(windowName); windowErr == nil {
				dialog.AttachToWindow(window)
			}
			dialog.Show()
			a.wailsApplication.Quit()
		}
		return false
	}
	return true
}

func (a *App) configureStartupLogging() {
	a.logger.SetEventEmitter(func(eventName string, args ...interface{}) {
		a.emitEvent(eventName, args...)
	})

	log.SetFlags(0)
	log.SetOutput(&stdLogBridge{logger: a.logger})
}

func (a *App) restoreStartupWindow(windowName string) {
	if settings, err := a.LoadWindowSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to load window settings: %v", err), logsources.App)
	} else if settings != nil {
		window, windowErr := a.workspaceWindow(windowName)
		if windowErr != nil {
			return
		}
		geometry, restorePosition := resolveWindowRestore(*settings, a.windowWorkAreas())
		window.SetSize(geometry.Width, geometry.Height)
		if restorePosition {
			window.SetPosition(geometry.X, geometry.Y)
		}
		if settings.Maximized {
			window.Maximise()
		}
	}
}

func (a *App) initializeStartupClusters() {
	a.logger.Info("Discovering kubeconfig files...", logsources.App)
	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.ErrorWithCause(err, "Failed to discover kubeconfigs", logsources.App)
	} else {
		a.logger.Info(fmt.Sprintf("Found %d kubeconfig file(s)", len(a.availableKubeconfigs)), logsources.App)
	}

	// The window is already visible, so settings restore and client initialization
	// share the runtime selection coordinator with any frontend mutation.
	selectedCount, err := a.initializeSelectedClustersAtStartup()
	if selectedCount > 0 {
		if err != nil {
			a.logger.ErrorWithCause(err, "Failed to connect to cluster(s)", logsources.App)
		} else {
			a.logger.Info("Successfully connected to Kubernetes cluster(s)", logsources.App)
		}
	} else {
		a.logger.Warn("No kubeconfig selections found - please select a cluster", logsources.App)
	}
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

// PrepareQuit flushes process state after the last peer window has agreed to
// close. Window geometry is saved separately while the chosen window exists.
func (a *App) PrepareQuit() bool {
	return a.prepareQuitFromWindow("")
}

// PrepareQuitFromWindow persists the geometry of the peer chosen by the
// window registry and then performs the once-only process shutdown flush.
func (a *App) PrepareQuitFromWindow(windowName string) bool {
	return a.prepareQuitFromWindow(strings.TrimSpace(windowName))
}

func (a *App) prepareQuitFromWindow(windowName string) bool {
	if a == nil {
		return true
	}
	a.preQuitOnce.Do(func() {
		a.logger.Info("Application close requested", logsources.App)
		if !a.waitForSelectionMutationIdle(beforeCloseSelectionFlushTimeout) {
			a.logger.Warn("Timed out waiting for cluster selection persistence before close", logsources.App)
		}
		if windowName != "" {
			if err := a.SaveWindowSettingsForWindow(windowName); err != nil {
				a.logger.Warn(fmt.Sprintf("Failed to save window settings: %v", err), logsources.App)
			} else {
				a.logger.Debug("Window settings saved successfully", logsources.App)
			}
		}
	})
	return true
}

// ServiceShutdown tears down process resources after the application context is
// cancelled and does not access the frontend runtime.
func (a *App) ServiceShutdown() error {
	a.logger.Info("Application shutdown initiated", logsources.App)
	if a.applicationUpdates != nil {
		a.applicationUpdates.Stop()
	}
	for _, unsubscribe := range a.applicationUpdateEventUnsubscribers {
		if unsubscribe != nil {
			unsubscribe()
		}
	}
	a.applicationUpdateEventUnsubscribers = nil

	// Shutdown all per-cluster auth managers to stop any recovery goroutines.
	a.clusterClientsMu.Lock()
	clusterIDSet := make(map[string]struct{})
	for _, clients := range a.clusterClients {
		if clients != nil && clients.meta.ID != "" {
			clusterIDSet[clients.meta.ID] = struct{}{}
		}
		if clients != nil && clients.authManager != nil {
			clients.authManager.Shutdown()
		}
	}
	a.clusterClientsMu.Unlock()

	for _, clusterID := range a.runtimeOperationClusterIDs() {
		clusterIDSet[clusterID] = struct{}{}
	}
	for clusterID := range clusterIDSet {
		a.cleanupClusterRuntimeOperations(clusterID, "app shutdown")
	}

	// Stop the kubeconfig directory watcher before tearing down cluster state.
	a.stopKubeconfigWatcher()

	a.teardownRefreshSubsystem()

	a.logger.Info("Application shutdown completed", logsources.App)
	a.clearApplicationContext()
	return nil
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
	}
	for _, pattern := range authPatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}
