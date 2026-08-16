package backend

import (
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// DesktopShell is the concrete owner of native Wails access and process-wide,
// non-persisted shell projection state.
type DesktopShell struct {
	application             *application.App
	runtimeAvailableFn      func() bool
	fallbackEmitter         func(string, ...interface{})
	logger                  *Logger
	menu                    *application.Menu
	createWorkspaceWindow   func()
	sidebarVisible          bool
	diagnosticsPanelVisible bool
	appLogsPanelVisible     bool
	openFileDialog          func(*application.OpenFileDialogOptions) (string, error)
	saveFileDialog          func(*application.SaveFileDialogOptions) (string, error)
	windowGeometry          func() (WindowGeometry, error)
	openApplicationURL      func(string) error
	quitApplication         func()
	checkForUpdates         func() error
	kubeconfigSearchPaths   func() ([]string, error)
	showExpiredBetaPrompt   func(expiredBetaPrompt)
}

func NewDesktopShell(
	wailsApplication *application.App,
	runtimeAvailable func() bool,
	fallbackEmitter func(string, ...interface{}),
	logger *Logger,
) *DesktopShell {
	shell := &DesktopShell{
		application:        wailsApplication,
		runtimeAvailableFn: runtimeAvailable,
		fallbackEmitter:    fallbackEmitter,
		logger:             logger,
		sidebarVisible:     true,
	}
	shell.openApplicationURL = func(url string) error {
		if wailsApplication == nil || wailsApplication.Browser == nil {
			return nil
		}
		return wailsApplication.Browser.OpenURL(url)
	}
	shell.quitApplication = func() {
		if wailsApplication != nil {
			wailsApplication.Quit()
		}
	}
	shell.showExpiredBetaPrompt = shell.presentExpiredBetaPrompt
	return shell
}

func (s *DesktopShell) Application() *application.App {
	if s == nil {
		return nil
	}
	return s.application
}

func (s *DesktopShell) UpdateClient() appupdates.Client {
	if s == nil || s.application == nil || s.application.Updater == nil {
		return nil
	}
	return s.application.Updater
}

func (s *DesktopShell) ConfigureUpdateCheck(check func() error) {
	if s != nil {
		s.checkForUpdates = check
	}
}

func (s *DesktopShell) ConfigureKubeconfigSearchPaths(read func() ([]string, error)) {
	if s != nil {
		s.kubeconfigSearchPaths = read
	}
}

func (s *DesktopShell) ResetProcessState() {
	if s == nil {
		return
	}
	s.sidebarVisible = true
	s.diagnosticsPanelVisible = false
	s.appLogsPanelVisible = false
	s.UpdateMenu()
}

func (s *DesktopShell) ShowSettings() {
	s.emitMenuProjection("Settings", "open-settings")
}

func (s *DesktopShell) ShowAbout() {
	s.emitMenuProjection("About", "open-about")
}

func (s *DesktopShell) emitMenuProjection(label, event string) {
	for attempt := 0; attempt < config.AppMenuTriggerMaxRetries; attempt++ {
		if s.runtimeAvailable() {
			if s.logger != nil {
				s.logger.Debug(label+" menu triggered", logsources.App)
			}
			s.emitCurrentWindowEvent(event)
			return
		}
		if attempt < config.AppMenuTriggerMaxRetries-1 {
			time.Sleep(config.AppMenuTriggerRetryDelay)
		}
	}
	if s != nil && s.logger != nil {
		s.logger.Warn("Cannot show "+strings.ToLower(label)+": application context is nil after retries", logsources.App)
	}
}

func (s *DesktopShell) showAboutAndCheckForUpdates() {
	if s == nil {
		return
	}
	s.ShowAbout()
	if s.checkForUpdates == nil {
		return
	}
	go func() {
		if err := s.checkForUpdates(); err != nil && s.logger != nil {
			s.logger.Warn(fmt.Sprintf("Application update check failed: %v", err), logsources.App)
		}
	}()
}

func (s *DesktopShell) runtimeAvailable() bool {
	return s != nil && s.runtimeAvailableFn != nil && s.runtimeAvailableFn()
}

func (s *DesktopShell) emitFallback(name string, data ...any) {
	if s != nil && s.fallbackEmitter != nil {
		s.fallbackEmitter(name, data...)
	}
}
