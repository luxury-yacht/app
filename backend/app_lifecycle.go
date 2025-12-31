package backend

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
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
	if ms := a.connectionStatusNextRetry; ms > 0 {
		a.updateConnectionStatus(a.connectionStatus, a.connectionStatusMessage, time.Duration(ms)*time.Millisecond)
	} else {
		a.updateConnectionStatus(a.connectionStatus, a.connectionStatusMessage, 0)
	}
	a.logger.Info("Application startup initiated", "App")

	errorcapture.Init()
	errorcapture.SetEventEmitter(func(message string) {
		a.emitEvent("backend-error", map[string]any{
			"message": strings.TrimSpace(message),
			"source":  "stderr",
		})
	})
	errorcapture.SetLogSink(func(level string, message string) {
		switch strings.ToLower(level) {
		case "error":
			a.logger.Error(message, "ErrorCapture")
		case "warn", "warning":
			a.logger.Warn(message, "ErrorCapture")
		default:
			a.logger.Debug(message, "ErrorCapture")
		}
	})

	if err := a.checkBetaExpiry(); err != nil {
		a.logger.Error(err.Error(), "App")
		runtimeMessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "Beta Version Expired",
			Message: err.Error(),
		})
		runtimeQuit(ctx)
		return
	}

	a.logger.SetEventEmitter(func(eventName string) {
		a.emitEvent(eventName)
	})

	log.SetFlags(0)
	log.SetOutput(&stdLogBridge{logger: a.logger})

	a.setupEnvironment()
	a.logger.Debug("Environment setup completed", "App")

	if settings, err := a.LoadWindowSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to load window settings: %v", err), "App")
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
	a.logger.Info("Luxury Yacht - Sail the Seas of Kubernetes In Style", "App")

	a.logger.Info("Discovering kubeconfig files...", "App")
	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.Error(fmt.Sprintf("Failed to discover kubeconfigs: %v", err), "App")
	} else {
		a.logger.Info(fmt.Sprintf("Found %d kubeconfig file(s)", len(a.availableKubeconfigs)), "App")
	}

	if err := a.loadAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to load app settings: %v", err), "App")
		a.appSettings = getDefaultAppSettings()
		a.logger.Info("Initialized app settings with defaults", "App")
	} else {
		a.logger.Debug("Application settings loaded successfully", "App")
	}

	a.restoreKubeconfigSelection()

	if a.selectedKubeconfig != "" {
		a.logger.Info(fmt.Sprintf("Connecting to cluster using: %s", filepath.Base(a.selectedKubeconfig)), "App")
		if err := a.initKubernetesClient(); err != nil {
			a.logger.Error(fmt.Sprintf("Failed to connect to cluster: %v", err), "App")
		} else {
			a.logger.Info("Successfully connected to Kubernetes cluster", "App")
		}
	} else {
		a.logger.Warn("No kubeconfig files found - please configure kubectl access", "App")
	}

	a.startHeartbeatLoop()
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

		lower := strings.ToLower(msg)
		switch {
		case strings.HasPrefix(lower, "error"), strings.Contains(lower, " error"), strings.HasPrefix(lower, "[error"), strings.Contains(lower, "[refresh:metrics] poll failed"):
			b.logger.Error(msg, "StdLog")
		case strings.HasPrefix(lower, "warn"), strings.Contains(lower, " warn"):
			b.logger.Warn(msg, "StdLog")
		default:
			b.logger.Info(msg, "StdLog")
		}
	}

	return len(p), nil
}

// NewBeforeCloseHandler runs while the window is still alive so window metrics can be read safely.
func NewBeforeCloseHandler(app *App) func(context.Context) bool {
	return func(ctx context.Context) bool {
		app.logger.Info("Application close requested", "App")

		if err := app.SaveWindowSettings(); err != nil {
			app.logger.Warn(fmt.Sprintf("Failed to save window settings: %v", err), "App")
		} else {
			app.logger.Debug("Window settings saved successfully", "App")
		}

		return false
	}
}

// Shutdown is called when the app is about to close and the frontend has been torn down.
func (a *App) Shutdown(ctx context.Context) {
	a.logger.Info("Application shutdown initiated", "App")

	a.teardownRefreshSubsystem()

	a.logger.Info("Application shutdown completed", "App")
}
