package backend

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type updateCheckPort struct {
	mu     sync.RWMutex
	target func() error
}

func (p *updateCheckPort) check() error {
	if p == nil {
		return fmt.Errorf("update check is not available")
	}
	p.mu.RLock()
	target := p.target
	p.mu.RUnlock()
	if target == nil {
		return fmt.Errorf("update check is not available")
	}
	return target()
}

func (p *updateCheckPort) bind(target func() error) {
	if p == nil || target == nil {
		panic("update check port requires a target")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.target != nil {
		panic("update check port already bound")
	}
	p.target = target
}

type DesktopShellBindings struct {
	UpdateCheck                func() error
	KubeconfigSearchPaths      func() ([]string, error)
	CreateWorkspaceWindow      func()
	IsWorkspaceWindow          func(string) bool
	NativeWindowDescriptor     func(string) (panelwindow.NativeDescriptor, error)
	BeginPanelWindowOpen       func(panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error)
	AcknowledgePanelReady      func(string, string) (panelwindow.WindowDescriptor, error)
	BeginPanelWindowDock       func(string, string, panelwindow.GroupSnapshot) error
	AcknowledgePanelDock       func(string, string, string) error
	FailPanelTransfer          func(string, string, string) error
	FocusPanelWindow           func(string, string, string) error
	RequestPanelClose          func(string, string, string) error
	AcknowledgePanelClose      func(string) error
	AcknowledgeWorkspaceClose  func(string) error
	RoutePanelCommand          func(string, string) error
	RequestPanelObjectOpen     func(string, panelwindow.ObjectReference, string) error
	AuthorizePanelObjectOpen   func(string, string, string, panelwindow.ObjectReference, string) error
	UpdatePanelSnapshot        func(string, panelwindow.GroupSnapshot) error
	RequestPanelTabClose       func(string, string) error
	AuthorizePanelTabClose     func(string, string, string) error
	RequestPanelTabTransfer    func(string, panelwindow.TabTransferRequest) error
	AcceptPanelTabTransfer     func(string, string) error
	FailPanelTabTransfer       func(string, string) error
	RequestPanelGuard          func(string, string, string, string) error
	AcknowledgePanelGuard      func(string, string, bool) error
	AcknowledgeApplicationQuit func(string, string, bool) error
}

// DesktopShell is the concrete owner of native Wails access and process-wide,
// non-persisted shell projection state.
type DesktopShell struct {
	application                *application.App
	runtimeAvailableFn         func() bool
	fallbackEmitter            func(string, ...interface{})
	logger                     *Logger
	menu                       *application.Menu
	createWorkspaceWindow      func()
	isWorkspaceWindow          func(string) bool
	nativeWindowDescriptor     func(string) (panelwindow.NativeDescriptor, error)
	beginPanelWindowOpen       func(panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error)
	acknowledgePanelReady      func(string, string) (panelwindow.WindowDescriptor, error)
	beginPanelWindowDock       func(string, string, panelwindow.GroupSnapshot) error
	acknowledgePanelDock       func(string, string, string) error
	failPanelTransfer          func(string, string, string) error
	focusPanelWindow           func(string, string, string) error
	requestPanelClose          func(string, string, string) error
	acknowledgePanelClose      func(string) error
	acknowledgeWorkspaceClose  func(string) error
	routePanelCommand          func(string, string) error
	requestPanelObjectOpen     func(string, panelwindow.ObjectReference, string) error
	authorizePanelObjectOpen   func(string, string, string, panelwindow.ObjectReference, string) error
	updatePanelSnapshot        func(string, panelwindow.GroupSnapshot) error
	requestPanelTabClose       func(string, string) error
	authorizePanelTabClose     func(string, string, string) error
	requestPanelTabTransfer    func(string, panelwindow.TabTransferRequest) error
	acceptPanelTabTransfer     func(string, string) error
	failPanelTabTransfer       func(string, string) error
	requestPanelGuard          func(string, string, string, string) error
	acknowledgePanelGuard      func(string, string, bool) error
	acknowledgeApplicationQuit func(string, string, bool) error
	sidebarVisible             bool
	diagnosticsPanelVisible    bool
	appLogsPanelVisible        bool
	openFileDialog             func(*application.OpenFileDialogOptions) (string, error)
	saveFileDialog             func(*application.SaveFileDialogOptions) (string, error)
	windowGeometry             func() (WindowGeometry, error)
	openApplicationURL         func(string) error
	quitApplication            func()
	checkForUpdates            func() error
	kubeconfigSearchPaths      func() ([]string, error)
	showExpiredBetaPrompt      func(expiredBetaPrompt)
}

func NewDesktopShell(
	wailsApplication *application.App,
	runtimeAvailable func() bool,
	fallbackEmitter func(string, ...interface{}),
	logger *Logger,
	bindings ...DesktopShellBindings,
) *DesktopShell {
	shell := &DesktopShell{
		application:        wailsApplication,
		runtimeAvailableFn: runtimeAvailable,
		fallbackEmitter:    fallbackEmitter,
		logger:             logger,
		sidebarVisible:     true,
	}
	if len(bindings) > 0 {
		shell.checkForUpdates = bindings[0].UpdateCheck
		shell.kubeconfigSearchPaths = bindings[0].KubeconfigSearchPaths
		shell.createWorkspaceWindow = bindings[0].CreateWorkspaceWindow
		shell.isWorkspaceWindow = bindings[0].IsWorkspaceWindow
		shell.nativeWindowDescriptor = bindings[0].NativeWindowDescriptor
		shell.beginPanelWindowOpen = bindings[0].BeginPanelWindowOpen
		shell.acknowledgePanelReady = bindings[0].AcknowledgePanelReady
		shell.beginPanelWindowDock = bindings[0].BeginPanelWindowDock
		shell.acknowledgePanelDock = bindings[0].AcknowledgePanelDock
		shell.failPanelTransfer = bindings[0].FailPanelTransfer
		shell.focusPanelWindow = bindings[0].FocusPanelWindow
		shell.requestPanelClose = bindings[0].RequestPanelClose
		shell.acknowledgePanelClose = bindings[0].AcknowledgePanelClose
		shell.acknowledgeWorkspaceClose = bindings[0].AcknowledgeWorkspaceClose
		shell.routePanelCommand = bindings[0].RoutePanelCommand
		shell.requestPanelObjectOpen = bindings[0].RequestPanelObjectOpen
		shell.authorizePanelObjectOpen = bindings[0].AuthorizePanelObjectOpen
		shell.updatePanelSnapshot = bindings[0].UpdatePanelSnapshot
		shell.requestPanelTabClose = bindings[0].RequestPanelTabClose
		shell.authorizePanelTabClose = bindings[0].AuthorizePanelTabClose
		shell.requestPanelTabTransfer = bindings[0].RequestPanelTabTransfer
		shell.acceptPanelTabTransfer = bindings[0].AcceptPanelTabTransfer
		shell.failPanelTabTransfer = bindings[0].FailPanelTabTransfer
		shell.requestPanelGuard = bindings[0].RequestPanelGuard
		shell.acknowledgePanelGuard = bindings[0].AcknowledgePanelGuard
		shell.acknowledgeApplicationQuit = bindings[0].AcknowledgeApplicationQuit
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

func (s *DesktopShell) hasWindowGeometry() bool {
	return s != nil && s.windowGeometry != nil
}

func (s *DesktopShell) OpenApplicationURL(url string) error {
	if s == nil || s.openApplicationURL == nil {
		return nil
	}
	return s.openApplicationURL(url)
}

func (s *DesktopShell) QuitApplication() {
	if s != nil && s.quitApplication != nil {
		s.quitApplication()
	}
}

func (s *DesktopShell) ShowExpiredBetaPrompt(prompt expiredBetaPrompt) {
	if s != nil && s.showExpiredBetaPrompt != nil {
		s.showExpiredBetaPrompt(prompt)
	}
}

func (s *DesktopShell) WindowWorkAreas() []WindowWorkArea {
	return s.windowWorkAreas()
}

func (s *DesktopShell) WorkspaceWindow(name string) (application.Window, error) {
	return s.workspaceWindow(name)
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
