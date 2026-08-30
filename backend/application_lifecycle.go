/*
 * backend/application_lifecycle.go
 *
 * Manages the lifecycle of the backend application.
 */

package backend

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logclassify"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const applicationDownloadsURL = "https://luxury-yacht.app/#downloads"

type expiredBetaPrompt struct {
	Title         string
	Message       string
	WindowName    string
	DownloadLabel string
	QuitLabel     string
	OnDownload    func()
	OnQuit        func()
}

var newRefreshSubsystemWithServices = system.NewSubsystemWithServices

const beforeCloseSelectionFlushTimeout = 2 * time.Second

// ApplicationLifecycle owns only process/window lifecycle state and the
// collaborators needed to order startup and shutdown. It is a focused owner,
// not the application composition root.
type ApplicationLifecycle struct {
	signals     *applicationRuntimeSignals
	preQuitOnce sync.Once

	desktopShell   lifecycleDesktopShell
	logger         *Logger
	startupState   startupStateCleaner
	preferences    lifecyclePreferences
	errorReporting installationMetricRegistrationScheduler
	clusterRuntime lifecycleClusterRuntime
	refresh        refreshSubsystemTeardowner
	workspace      lifecycleWorkspace
	operations     operationsShutdowner
	updates        lifecycleUpdates
}

type lifecycleDesktopShell interface {
	OpenApplicationURL(string) error
	QuitApplication()
	ShowExpiredBetaPrompt(expiredBetaPrompt)
	WindowWorkAreas() []WindowWorkArea
	WorkspaceWindow(string) (application.Window, error)
}

type lifecyclePreferences interface {
	LoadWindowSettings() (*WindowSettings, error)
	SaveWindowSettingsForWindow(string) error
}

type startupStateCleaner interface {
	CleanupStaleWrites() error
}

type installationMetricRegistrationScheduler interface {
	scheduleInstallationMetricRegistration(context.Context)
}

type lifecycleClusterRuntime interface {
	GetKubeconfigs() (KubeconfigDiscoveryResult, error)
	anyClusterAuthInvalid() bool
	consumeIntents(context.Context, func(ClusterRuntimeIntent))
	discoverKubeconfigs() error
	initializeClusterLifecycle()
	startKubeconfigWatcher() error
	stopAuthRecovery()
	stopIntentConsumption()
	stopKubeconfigWatcher()
}

type refreshSubsystemTeardowner interface {
	teardownRefreshSubsystem()
}

type lifecycleWorkspace interface {
	ReleaseWorkspaceWindow(string)
	connectSelectedClustersAtStartup(context.Context) error
	consumeClusterRuntimeIntent(ClusterRuntimeIntent)
	initializeSelectedClustersAtStartup() (int, context.Context, error)
	waitForSelectionMutationIdle(time.Duration) bool
}

type operationsShutdowner interface {
	Shutdown()
}

type lifecycleUpdates interface {
	RuntimeReady()
	Stop()
}

type ApplicationLifecycleDependencies struct {
	DesktopShell   lifecycleDesktopShell
	Logger         *Logger
	StartupState   startupStateCleaner
	Preferences    lifecyclePreferences
	ErrorReporting installationMetricRegistrationScheduler
	ClusterRuntime lifecycleClusterRuntime
	Refresh        refreshSubsystemTeardowner
	Workspace      lifecycleWorkspace
	Operations     operationsShutdowner
	Updates        lifecycleUpdates
}

func newApplicationLifecycle(
	signals *applicationRuntimeSignals,
	dependencies ApplicationLifecycleDependencies,
) *ApplicationLifecycle {
	if signals == nil {
		signals = newApplicationRuntimeSignals(nil)
	}
	logger := dependencies.Logger
	if logger == nil {
		logger = NewLogger(1000)
	}
	return &ApplicationLifecycle{
		signals:        signals,
		desktopShell:   dependencies.DesktopShell,
		logger:         logger,
		startupState:   dependencies.StartupState,
		preferences:    dependencies.Preferences,
		errorReporting: dependencies.ErrorReporting,
		clusterRuntime: dependencies.ClusterRuntime,
		refresh:        dependencies.Refresh,
		workspace:      dependencies.Workspace,
		operations:     dependencies.Operations,
		updates:        dependencies.Updates,
	}
}

// ServiceStartup performs bounded, non-UI process initialization before native
// windows start. Interactive startup waits for WindowRuntimeReady.
func (a *ApplicationLifecycle) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// Process-global Kubernetes logging must be installed before any owner can
	// start a client or informer. Both installers are idempotent.
	errorcapture.Init()
	errorcapture.InstallUnhandledErrorDedup()
	a.cleanupStaleAppStateWrites()
	a.setApplicationContext(ctx)
	go a.clusterRuntime.consumeIntents(ctx, a.workspace.consumeClusterRuntimeIntent)
	a.clusterRuntime.initializeClusterLifecycle()
	a.logger.Info("Application startup initiated", logsources.App)
	a.startDiagnosticDumpHandler(ctx)
	a.configureStartupErrorCapture()
	a.configureStartupLogging()
	a.setupEnvironment()
	a.logger.Debug("Environment setup completed", logsources.App)
	return nil
}

func (a *ApplicationLifecycle) cleanupStaleAppStateWrites() {
	if a.startupState == nil {
		return
	}
	if err := a.startupState.CleanupStaleWrites(); err != nil {
		a.logger.Warn(fmt.Sprintf("Could not remove stale app state temporary files: %v", err), logsources.App)
	}
}

// WindowRuntimeReady runs interactive initialization once the webview runtime
// can receive events and JavaScript without dropping or merely queueing them.
func (a *ApplicationLifecycle) WindowRuntimeReady(windowName string, restoreGeometry bool) bool {
	firstReadyWindow := a.markRuntimeReady()
	if firstReadyWindow && !a.checkStartupBetaExpiry(windowName) {
		return true
	}
	if restoreGeometry {
		a.restoreStartupWindow(windowName)
	}
	if window, err := a.desktopShell.WorkspaceWindow(windowName); err == nil {
		window.Show()
	}
	if !firstReadyWindow {
		return false
	}
	a.logger.Info("Luxury Yacht - Sail the Seas of Kubernetes In Style", logsources.App)
	a.initializeStartupClusters()
	if err := a.clusterRuntime.startKubeconfigWatcher(); err != nil {
		a.logger.Warn(fmt.Sprintf("Kubeconfig directory watcher not available: %v", err), logsources.App)
	}
	if a.updates != nil {
		a.updates.RuntimeReady()
	}
	a.errorReporting.scheduleInstallationMetricRegistration(a.CtxOrBackground())
	return true
}

func (a *ApplicationLifecycle) configureStartupErrorCapture() {
	errorcapture.SetEventEmitter(func(message string) {
		// Note: Auth state management is now per-cluster via transport wrappers.
		// Stderr errors don't have cluster context, so we only emit to frontend
		// for UI display. The per-cluster auth managers handle state based on
		// 401 responses, which DO have cluster context.
		// clusterId is empty here because stderr errors are not associated with
		// a specific cluster.
		a.emitEvent(backendErrorEventName, BackendErrorEvent{
			ClusterID: "",
			Message:   strings.TrimSpace(message),
			Source:    "stderr",
		})
	})
	errorcapture.SetLogSink(func(level, message string) {
		// Suppress logging when ANY cluster has auth issues to prevent log spam.
		// Auth-related errors are already being handled by the per-cluster auth managers.
		if a.clusterRuntime.anyClusterAuthInvalid() {
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

func (a *ApplicationLifecycle) checkStartupBetaExpiry(windowName string) bool {
	if err := a.checkBetaExpiry(); err != nil {
		applog.ReportError(a.logger, err, "Beta version expired", logsources.App)
		if a.desktopShell != nil {
			a.desktopShell.ShowExpiredBetaPrompt(expiredBetaPrompt{
				Title:         "Beta Version Expired",
				Message:       err.Error(),
				WindowName:    windowName,
				DownloadLabel: "Download Latest Version",
				QuitLabel:     "Quit",
				OnDownload: func() {
					if openErr := a.desktopShell.OpenApplicationURL(applicationDownloadsURL); openErr != nil {
						a.logger.Warn(fmt.Sprintf("Could not open the latest-version download page: %v", openErr), logsources.App)
					}
					a.desktopShell.QuitApplication()
				},
				OnQuit: a.desktopShell.QuitApplication,
			})
		}
		return false
	}
	return true
}

func (a *ApplicationLifecycle) configureStartupLogging() {
	a.logger.SetEventEmitter(func(eventName string, args ...interface{}) {
		a.emitEvent(eventName, args...)
	})

	log.SetFlags(0)
	log.SetOutput(&stdLogBridge{logger: a.logger})
}

func (a *ApplicationLifecycle) restoreStartupWindow(windowName string) {
	if settings, err := a.preferences.LoadWindowSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to load window settings: %v", err), logsources.App)
	} else if settings != nil {
		window, windowErr := a.desktopShell.WorkspaceWindow(windowName)
		if windowErr != nil {
			return
		}
		geometry, restorePosition := resolveWindowRestore(*settings, a.desktopShell.WindowWorkAreas())
		window.SetSize(geometry.Width, geometry.Height)
		if restorePosition {
			window.SetPosition(geometry.X, geometry.Y)
		}
		if settings.Maximized {
			window.Maximise()
		}
	}
}

func (a *ApplicationLifecycle) initializeStartupClusters() {
	a.logger.Info("Discovering kubeconfig files...", logsources.App)
	if err := a.clusterRuntime.discoverKubeconfigs(); err != nil {
		a.logger.ErrorWithCause(err, "Failed to discover kubeconfigs", logsources.App)
	} else {
		result, _ := a.clusterRuntime.GetKubeconfigs()
		a.logger.Info(fmt.Sprintf("Found %d kubeconfig file(s)", len(result.Kubeconfigs)), logsources.App)
	}

	// Restore the durable selection before the frontend hydrates. Cluster client
	// and refresh initialization continues independently so an unreachable API
	// server cannot block the native runtime or workspace reads.
	selectedCount, connectionCtx, err := a.workspace.initializeSelectedClustersAtStartup()
	if selectedCount > 0 {
		if err != nil {
			a.logger.ErrorWithCause(err, "Failed to restore selected cluster(s)", logsources.App)
		} else {
			go func() {
				if connectErr := a.workspace.connectSelectedClustersAtStartup(connectionCtx); connectErr != nil {
					if errors.Is(connectErr, context.Canceled) {
						return
					}
					a.logger.ErrorWithCause(connectErr, "Failed to connect to cluster(s)", logsources.App)
					return
				}
				a.logger.Info("Successfully connected to Kubernetes cluster(s)", logsources.App)
			}()
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
func (a *ApplicationLifecycle) PrepareQuit() bool {
	return a.prepareQuitFromWindow("")
}

// PrepareQuitFromWindow persists the geometry of the peer chosen by the
// window registry and then performs the once-only process shutdown flush.
func (a *ApplicationLifecycle) PrepareQuitFromWindow(windowName string) bool {
	return a.prepareQuitFromWindow(strings.TrimSpace(windowName))
}

func (a *ApplicationLifecycle) prepareQuitFromWindow(windowName string) bool {
	if a == nil {
		return true
	}
	a.preQuitOnce.Do(func() {
		a.logger.Info("Application close requested", logsources.App)
		if !a.workspace.waitForSelectionMutationIdle(beforeCloseSelectionFlushTimeout) {
			a.logger.Warn("Timed out waiting for cluster selection persistence before close", logsources.App)
		}
		if windowName != "" {
			if err := a.preferences.SaveWindowSettingsForWindow(windowName); err != nil {
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
func (a *ApplicationLifecycle) ServiceShutdown() error {
	a.logger.Info("Application shutdown initiated", logsources.App)
	if a.updates != nil {
		a.updates.Stop()
	}

	// Stop cross-owner intent consumption before auth callbacks and watcher
	// producers are shut down.
	a.clusterRuntime.stopIntentConsumption()
	a.clusterRuntime.stopAuthRecovery()

	if a.operations != nil {
		a.operations.Shutdown()
	}

	// Stop the kubeconfig directory watcher before tearing down cluster state.
	a.clusterRuntime.stopKubeconfigWatcher()

	a.refresh.teardownRefreshSubsystem()

	a.logger.Info("Application shutdown completed", logsources.App)
	a.clearApplicationContext()
	return nil
}

func (a *ApplicationLifecycle) ReleaseWorkspaceWindow(windowID string) {
	if a != nil && a.workspace != nil {
		a.workspace.ReleaseWorkspaceWindow(windowID)
	}
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
