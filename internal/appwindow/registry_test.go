package appwindow

import (
	"runtime"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type recordingLifecycleBackend struct {
	releasedPanelReferences []string
	directory               *panelwindow.WorkspaceDirectory
	windowClusters          map[string][]string
	releasedWindow          string
	preparedWindow          string
	allowQuit               bool
	readyWindows            []string
}

func (b *recordingLifecycleBackend) PanelWorkspaceDirectory() *panelwindow.WorkspaceDirectory {
	if b.directory == nil {
		b.directory = panelwindow.NewWorkspaceDirectory()
	}
	return b.directory
}
func (b *recordingLifecycleBackend) RetainPanelCluster(string, string) error { return nil }
func (b *recordingLifecycleBackend) ReleasePanelCluster(reference string) error {
	b.releasedPanelReferences = append(b.releasedPanelReferences, reference)
	return nil
}

func (b *recordingLifecycleBackend) WindowClusterIDs(windowName string) []string {
	if b.windowClusters == nil {
		return []string{"cluster-1"}
	}
	return b.windowClusters[windowName]
}

func (b *recordingLifecycleBackend) WindowRuntimeReady(windowName string, _ bool) bool {
	b.readyWindows = append(b.readyWindows, windowName)
	return true
}

func (b *recordingLifecycleBackend) ReleaseWorkspaceWindow(windowID string) {
	b.releasedWindow = windowID
}

func (b *recordingLifecycleBackend) PrepareQuitFromWindow(windowName string) bool {
	b.preparedWindow = windowName
	return b.allowQuit
}

func TestVisibilityPreservesPlatformStartupContract(t *testing.T) {
	for _, test := range []struct {
		goos       string
		wantHidden bool
	}{
		{goos: "darwin", wantHidden: true},
		{goos: "windows", wantHidden: true},
		{goos: "linux", wantHidden: false},
	} {
		t.Run(test.goos, func(t *testing.T) {
			options := windowOptionsForPlatform("workspace-7", test.goos)

			require.Equal(t, test.wantHidden, options.Hidden)
		})
	}
}

func TestOptionsPreserveTheSharedPeerContract(t *testing.T) {
	for _, test := range []struct {
		goos                       string
		wantBackgroundType         application.BackgroundType
		wantApplicationMenu        bool
		wantFrameless              bool
		wantWindowsMenuOff         bool
		wantNonClientRegionSupport bool
	}{
		{
			goos:                "darwin",
			wantBackgroundType:  application.BackgroundTypeTransparent,
			wantApplicationMenu: true,
		},
		{
			goos:                       "windows",
			wantBackgroundType:         application.BackgroundTypeSolid,
			wantFrameless:              true,
			wantWindowsMenuOff:         true,
			wantNonClientRegionSupport: false,
		},
		{
			goos:               "linux",
			wantBackgroundType: application.BackgroundTypeTransparent,
			wantFrameless:      true,
		},
	} {
		t.Run(test.goos, func(t *testing.T) {
			options := windowOptionsForPlatform("workspace-7", test.goos)

			require.Equal(t, "workspace-7", options.Name)
			require.Equal(t, "Luxury Yacht", options.Title)
			require.Equal(t, 1200, options.Width)
			require.Equal(t, 800, options.Height)
			require.Equal(t, 1100, options.MinWidth)
			require.Equal(t, 600, options.MinHeight)
			require.Zero(t, options.MaxWidth)
			require.Zero(t, options.MaxHeight)
			require.False(t, options.DisableResize)
			require.Equal(t, "/", options.URL)
			require.Equal(t, application.NewRGB(30, 30, 30), options.BackgroundColour)
			require.Equal(t, test.wantBackgroundType, options.BackgroundType)
			require.True(t, options.Mac.TitleBar.AppearsTransparent)
			require.True(t, options.Mac.TitleBar.FullSizeContent)
			require.True(t, options.Mac.TitleBar.HideTitle)
			require.True(t, options.Mac.TitleBar.HideToolbarSeparator)
			require.Equal(t, application.SystemDefault, options.Windows.Theme)
			require.Nil(t, options.Linux.Menu)
			require.Equal(t, test.wantFrameless, options.Frameless)
			require.Equal(t, test.wantApplicationMenu, options.UseApplicationMenu)
			require.Equal(t, test.wantWindowsMenuOff, options.Windows.DisableMenu)
			require.Equal(
				t, test.wantNonClientRegionSupport,
				options.Windows.NonClientRegionSupport,
			)
			require.False(t, options.Windows.DisableFramelessWindowDecorations)
			require.False(t, options.Windows.WebView2CompositionHosting)
			require.Equal(t, 1.0, options.Zoom)
			require.False(t, options.ZoomControlEnabled)
			require.Equal(t, test.goos != "linux", options.Hidden)
		})
	}
}

func TestPanelOptionsUseSharedEntryAndPlatformWindowChrome(t *testing.T) {
	for _, test := range []struct {
		goos                       string
		wantTitle                  string
		wantApplicationMenu        bool
		wantFrameless              bool
		wantWindowsMenuOff         bool
		wantNonClientRegionSupport bool
	}{
		{goos: "darwin", wantApplicationMenu: true},
		{
			goos:                       "windows",
			wantFrameless:              true,
			wantWindowsMenuOff:         true,
			wantNonClientRegionSupport: false,
		},
		{goos: "linux", wantTitle: " ", wantFrameless: true},
	} {
		t.Run(test.goos, func(t *testing.T) {
			options := panelWindowOptionsForPlatform("panel-7", test.goos, nil)

			require.Equal(t, "panel-7", options.Name)
			require.Equal(t, test.wantTitle, options.Title)
			require.Equal(t, "/", options.URL)
			require.Equal(t, 500, options.Width)
			require.Equal(t, 400, options.Height)
			require.Equal(t, 450, options.MinWidth)
			require.Equal(t, 200, options.MinHeight)
			require.True(t, options.Hidden)
			require.False(t, options.AlwaysOnTop)
			require.False(t, options.DisableResize)
			require.Equal(t, test.wantFrameless, options.Frameless)
			require.True(t, options.Mac.TitleBar.AppearsTransparent)
			require.True(t, options.Mac.TitleBar.FullSizeContent)
			require.True(t, options.Mac.TitleBar.HideTitle)
			require.True(t, options.Mac.TitleBar.HideToolbarSeparator)
			require.Zero(t, options.InitialPosition)
			require.Zero(t, options.StartState)
			require.Nil(t, options.Screen)
			require.Nil(t, options.Linux.Menu)
			require.Equal(t, test.wantApplicationMenu, options.UseApplicationMenu)
			require.Equal(t, test.wantWindowsMenuOff, options.Windows.DisableMenu)
			require.Equal(
				t,
				test.wantNonClientRegionSupport,
				options.Windows.NonClientRegionSupport,
			)
			require.False(t, options.Windows.DisableFramelessWindowDecorations)
			require.False(t, options.Windows.WebView2CompositionHosting)
		})
	}
}

func TestPanelOptionsUseTransferredInitialBoundsOnce(t *testing.T) {
	options := panelWindowOptionsForPlatform(
		"panel-7", "darwin",
		&panelwindow.WindowBounds{X: 140, Y: 80, Width: 720, Height: 560},
	)

	require.Equal(t, application.WindowXY, options.InitialPosition)
	require.Equal(t, 140, options.X)
	require.Equal(t, 80, options.Y)
	require.Equal(t, 720, options.Width)
	require.Equal(t, 560, options.Height)
}

func TestRegistryCentersPanelWindowBoundsOnTheOwnerNativeFrame(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	registry.panelOpenTimeout = 0
	registry.windowGeometry = func(name string) (geometry, bool) {
		require.Equal(t, owner.Name(), name)
		return geometry{
			AbsoluteX: 2000,
			AbsoluteY: 80,
			Width:     1000,
			Height:    700,
			Screen: &application.Screen{
				WorkArea: application.Rect{X: 1920, Y: 40, Width: 1200, Height: 760},
			},
		}, true
	}
	var createdOptions application.WebviewWindowOptions
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		createdOptions = options
		return application.NewWindow(options)
	}
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	snapshot.InitialBounds = &panelwindow.WindowBounds{X: 2900, Y: 700, Width: 720, Height: 560}

	_, err := beginTestPanelWindow(t, registry, snapshot)

	require.NoError(t, err)
	require.Equal(t, 2140, createdOptions.X)
	require.Equal(t, 150, createdOptions.Y)
	require.Equal(t, 720, createdOptions.Width)
	require.Equal(t, 560, createdOptions.Height)
}

func TestRegistryCentersPanelWindowWhenOwnerNativeGeometryIsUnavailable(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	registry.panelOpenTimeout = 0
	registry.windowGeometry = func(string) (geometry, bool) {
		return geometry{}, false
	}
	var createdOptions application.WebviewWindowOptions
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		createdOptions = options
		return application.NewWindow(options)
	}
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	snapshot.InitialBounds = &panelwindow.WindowBounds{X: 2900, Y: 700, Width: 720, Height: 560}

	_, err := beginTestPanelWindow(t, registry, snapshot)

	require.NoError(t, err)
	require.Equal(t, application.WindowCentered, createdOptions.InitialPosition)
	require.Equal(t, 720, createdOptions.Width)
	require.Equal(t, 560, createdOptions.Height)
}

func TestRegistryUsesTearOffCursorPositionOnItsTargetScreen(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	registry.panelOpenTimeout = 0
	registry.panelScreenWorkAreas = func() []application.Rect {
		return []application.Rect{
			{X: 0, Y: 0, Width: 1920, Height: 1040},
			{X: 1920, Y: 0, Width: 1200, Height: 760},
		}
	}
	var createdOptions application.WebviewWindowOptions
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		createdOptions = options
		return application.NewWindow(options)
	}
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	snapshot.UseInitialPosition = true
	snapshot.InitialBounds = &panelwindow.WindowBounds{X: 1805, Y: 76, Width: 600, Height: 800}
	snapshot.InitialPositionAnchor = &panelwindow.WindowPoint{X: 1925, Y: 100}

	_, err := beginTestPanelWindow(t, registry, snapshot)

	require.NoError(t, err)
	require.Equal(t, application.WindowXY, createdOptions.InitialPosition)
	require.Equal(t, 1920, createdOptions.X)
	require.Equal(t, 0, createdOptions.Y)
	require.Equal(t, 600, createdOptions.Width)
	require.Equal(t, 760, createdOptions.Height)
}

func TestReadyWorkspaceCloseAlwaysRunsFrontendPreflight(t *testing.T) {
	backend := &recordingLifecycleBackend{}
	lifecycle := newLifecycle()
	workspaceName := lifecycle.Add()
	var eventName string
	registry := &Registry{
		backend:   backend,
		lifecycle: lifecycle,
		panels:    newPanelIndex(),
		emitWindowEvent: func(target, name string, _ any) bool {
			require.Equal(t, workspaceName, target)
			eventName = name
			return true
		},
	}

	registry.markWorkspaceReady(workspaceName)
	registry.handleClosing(nil, workspaceName)

	require.Equal(t, panelwindow.WorkspaceCloseRequestedEventName, eventName)
	require.Equal(t, 1, lifecycle.Count())
	require.Empty(t, backend.releasedWindow)
	require.Empty(t, backend.preparedWindow)
}

func TestRegistryCreatesPeersFromTheMostRecentWindowGeometry(t *testing.T) {
	lifecycle := newLifecycle()
	sourceName := lifecycle.Add()
	sourceScreen := &application.Screen{
		ID:       "secondary",
		WorkArea: application.Rect{X: 1920, Y: 0, Width: 1920, Height: 1040},
	}
	var createdOptions application.WebviewWindowOptions
	registry := &Registry{
		lifecycle: lifecycle,
		newWindow: func(options application.WebviewWindowOptions) *application.WebviewWindow {
			createdOptions = options
			return application.NewWindow(options)
		},
		windowGeometry: func(name string) (geometry, bool) {
			require.Equal(t, sourceName, name)
			return geometry{
				X:         140,
				Y:         90,
				Width:     1440,
				Height:    900,
				Maximised: true,
				Screen:    sourceScreen,
			}, true
		},
	}

	created := registry.Create(false)

	require.Equal(t, "workspace-2", created.Name())
	require.Equal(t, 1440, createdOptions.Width)
	require.Equal(t, 900, createdOptions.Height)
	require.Equal(t, application.WindowXY, createdOptions.InitialPosition)
	require.Equal(t, 164, createdOptions.X)
	require.Equal(t, 114, createdOptions.Y)
	require.Same(t, sourceScreen, createdOptions.Screen)
	require.Equal(t, application.WindowStateMaximised, createdOptions.StartState)
}

func TestRegistryKeepsCascadedPeersOnTheSourceScreen(t *testing.T) {
	lifecycle := newLifecycle()
	lifecycle.Add()
	sourceScreen := &application.Screen{
		ID:       "primary",
		WorkArea: application.Rect{Width: 1200, Height: 800},
	}
	var createdOptions application.WebviewWindowOptions
	registry := &Registry{
		lifecycle: lifecycle,
		newWindow: func(options application.WebviewWindowOptions) *application.WebviewWindow {
			createdOptions = options
			return application.NewWindow(options)
		},
		windowGeometry: func(string) (geometry, bool) {
			return geometry{
				X:      80,
				Y:      100,
				Width:  1100,
				Height: 600,
				Screen: sourceScreen,
			}, true
		},
	}

	registry.Create(false)

	require.Equal(t, 56, createdOptions.X)
	require.Equal(t, 124, createdOptions.Y)
}

func TestPeerOptionsInheritSizeWithoutPositionWhenTheSourceScreenIsUnavailable(t *testing.T) {
	registry := &Registry{
		windowGeometry: func(string) (geometry, bool) {
			return geometry{Width: 1400, Height: 900}, true
		},
	}

	options := registry.optionsForPeer("workspace-2", "workspace-1", false)

	require.Equal(t, 1400, options.Width)
	require.Equal(t, 900, options.Height)
	require.Zero(t, options.InitialPosition)
	require.Nil(t, options.Screen)
	require.Zero(t, options.StartState)
}

func TestRegistryCreatesAndCountsPeersThroughTheWailsWindowManager(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})

	require.Zero(t, registry.Count())
	first := registry.Create(true)
	second := registry.Create(false)

	require.Equal(t, "workspace-1", first.Name())
	require.Equal(t, "workspace-2", second.Name())
	require.Equal(t, 2, registry.Count())
}

func TestRegistryCreatesPanelOutsideWorkspaceLifecycleAccounting(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()

	panel, err := beginTestPanelWindow(t, registry, snapshot)

	require.NoError(t, err)
	require.Equal(t, "panel-1", panel.WindowName)
	require.Equal(t, 1, registry.Count())
}

func TestRegistryBeginsHiddenPanelTransferWithPlatformWindowOptions(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	var createdOptions application.WebviewWindowOptions
	var configuredWindow *application.WebviewWindow
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		createdOptions = options
		return application.NewWindow(options)
	}
	registry.configurePanelWindow = func(window *application.WebviewWindow) {
		configuredWindow = window
	}

	descriptor, err := beginTestPanelWindow(t, registry, snapshot)

	require.NoError(t, err)
	require.Equal(t, "panel-1", descriptor.WindowName)
	require.Equal(t, PanelWindowStateOpening, descriptor.State)
	require.Equal(t, "panel-1", createdOptions.Name)
	require.Equal(t, "/", createdOptions.URL)
	require.Equal(t, 500, createdOptions.Width)
	require.Equal(t, 400, createdOptions.Height)
	require.Equal(t, 450, createdOptions.MinWidth)
	require.Equal(t, 200, createdOptions.MinHeight)
	require.True(t, createdOptions.Hidden)
	require.False(t, createdOptions.AlwaysOnTop)
	require.False(t, createdOptions.DisableResize)
	require.Equal(t, runtime.GOOS != "darwin", createdOptions.Frameless)
	require.False(t, createdOptions.Windows.NonClientRegionSupport)
	require.True(t, createdOptions.Mac.TitleBar.FullSizeContent)
	require.NotNil(t, configuredWindow)
	require.Equal(t, descriptor.WindowName, configuredWindow.Name())
	require.Equal(t, 1, registry.Count())
}

func TestRegistryRejectsPanelWithUnknownOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = "workspace-missing"

	panel, err := beginTestPanelWindow(t, registry, snapshot)

	require.ErrorContains(t, err, "source window")
	require.Empty(t, panel)
	require.Zero(t, registry.Count())
}

func TestRegistryRejectsIncompletePanelIdentity(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	valid := validPanelGroupSnapshot()
	valid.SourceWindowName = owner.Name()

	for _, test := range []struct {
		name   string
		mutate func(*PanelGroupSnapshot)
	}{
		{
			name: "missing cluster",
			mutate: func(snapshot *PanelGroupSnapshot) {
				snapshot.ClusterID = ""
			},
		},
		{
			name: "missing group",
			mutate: func(snapshot *PanelGroupSnapshot) {
				snapshot.GroupID = ""
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			snapshot := valid
			test.mutate(&snapshot)
			panel, err := beginTestPanelWindow(t, registry, snapshot)

			require.Error(t, err)
			require.Empty(t, panel)
		})
	}
}

func TestRegistryRejectsDuplicatePanelGroupWithinOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	first, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	require.NotEmpty(t, first)

	duplicateSnapshot := snapshot
	duplicateSnapshot.TransferID = "transfer-2"
	duplicate, err := beginTestPanelWindow(t, registry, duplicateSnapshot)

	require.ErrorContains(t, err, "already owns panel group")
	require.Empty(t, duplicate)
	require.Equal(t, 1, registry.Count())
}

func TestAuthorizedPanelClosingHookLeavesCommitToTheRequestTransaction(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)

	registry.authorizeClose(descriptor.WindowName)
	registry.handlePanelClosingEvent(nil, descriptor.WindowName)

	stored, err := registry.PanelDescriptor(descriptor.WindowName)
	require.NoError(t, err)
	require.Equal(t, descriptor.WindowName, stored.WindowName)
}

func TestPanelClosingHookCancelsAndRoutesAnUnauthorizedNativeClose(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	var routed panelwindow.WindowCloseRequestedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, descriptor.WindowName, target)
		require.Equal(t, panelwindow.WindowCloseRequestedEventName, eventName)
		routed = payload.(panelwindow.WindowCloseRequestedEvent)
		return true
	}
	event := application.NewWindowEvent()

	registry.handlePanelClosingEvent(event, descriptor.WindowName)

	require.True(t, event.IsCancelled())
	require.Equal(t, descriptor.WindowName, routed.WindowName)
	require.Equal(t, "titlebar", routed.Reason)
}

func TestRegistryRoutesPanelMenuCommandsAndFocusesTheOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	var focused string
	registry.focusWindow = func(windowName string) bool {
		focused = windowName
		return true
	}
	routedEvents := []string{}
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		require.Equal(t, owner.Name(), target)
		routedEvents = append(routedEvents, eventName)
		return true
	}

	require.NoError(t, registry.RoutePanelWindowCommand(descriptor.WindowName, panelwindow.WorkspaceCommandOpenSettings))
	require.NoError(
		t,
		registry.RoutePanelWindowCommand(descriptor.WindowName, panelwindow.WorkspaceCommandTogglePanelDebug),
	)
	require.Equal(t, owner.Name(), focused)
	require.Equal(t, []string{"open-settings", "debug:toggle-panel-overlay"}, routedEvents)
}

func TestRegistryShowsPanelOnlyAfterMatchingReadyAcknowledgement(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	var shown []string
	registry.showWindow = func(name string) bool {
		shown = append(shown, name)
		return true
	}

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, "stale-transfer")
	require.ErrorContains(t, err, "stale panel transfer")
	require.Empty(t, shown)
	stored, err := registry.PanelDescriptor(descriptor.WindowName)
	require.NoError(t, err)
	require.Equal(t, PanelWindowStateOpening, stored.State)

	ready, err := registry.AcknowledgePanelWindowReady(
		descriptor.WindowName,
		snapshot.TransferID,
	)
	require.NoError(t, err)
	require.Equal(t, PanelWindowStateLive, ready.State)
	require.Equal(t, []string{descriptor.WindowName}, shown)
}

func TestRegistryReportsPanelClosedWhenReadyWindowDisappearsBeforeShow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return false }

	var closed panelwindow.WindowClosedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, owner.Name(), target)
		require.Equal(t, panelwindow.WindowClosedEventName, eventName)
		closed = payload.(panelwindow.WindowClosedEvent)
		return true
	}

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)

	require.ErrorContains(t, err, "disappeared before ready")
	require.Equal(t, panelwindow.WindowClosedEvent{
		WindowName: descriptor.WindowName,
		ClusterID:  descriptor.ClusterID,
		GroupID:    descriptor.GroupID,
	}, closed)
	_, descriptorErr := registry.PanelDescriptor(descriptor.WindowName)
	require.Error(t, descriptorErr)
}

func TestRegistryKeepsReadyPanelWhenSourceAppCannotReceiveOpenedEvent(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = source.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	registry.closeWindow = func(string) bool { t.Fatal("committed panel must survive an unavailable source"); return false }
	registry.emitWindowEvent = func(string, string, any) bool { return false }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	require.Equal(t, PanelWindowStateLive, registry.panels.State(descriptor.WindowName))
	require.Equal(t, descriptor.WindowName, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
}

func TestRegistryRoutesOpenToSourceAndDockToAnAppDisplayingTheCluster(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	var events []struct {
		windowName string
		eventName  string
		payload    any
	}
	var closed []string
	registry.emitWindowEvent = func(windowName, eventName string, payload any) bool {
		if eventName == panelwindow.WorkspaceChangedEventName {
			return true
		}
		events = append(events, struct {
			windowName string
			eventName  string
			payload    any
		}{windowName, eventName, payload})
		return true
	}
	registry.closeWindow = func(windowName string) bool {
		closed = append(closed, windowName)
		return true
	}
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, owner.Name(), events[0].windowName)
	require.Equal(t, PanelWindowOpenedEventName, events[0].eventName)

	dockSnapshot := snapshot
	dockSnapshot.SourceWindowName = descriptor.WindowName
	dockSnapshot.TransferID = "transfer-dock"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "right", dockSnapshot))
	require.Len(t, events, 2)
	require.Equal(t, owner.Name(), events[1].windowName)
	require.Equal(t, PanelWindowDockRequestedEventName, events[1].eventName)

	require.NoError(
		t,
		registry.AcknowledgePanelWindowDock(owner.Name(), descriptor.WindowName, dockSnapshot.TransferID),
	)
	require.Equal(t, []string{descriptor.WindowName}, closed)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
}

func TestRegistryFailedDockCloseLeavesNativeSourceLive(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)

	dockSnapshot := snapshot
	dockSnapshot.SourceWindowName = descriptor.WindowName
	dockSnapshot.TransferID = "transfer-dock-failure"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "bottom", dockSnapshot))
	registry.closeWindow = func(string) bool { return false }

	err = registry.AcknowledgePanelWindowDock(
		owner.Name(), descriptor.WindowName, dockSnapshot.TransferID,
	)
	require.ErrorContains(t, err, "not available")
	require.Equal(t, PanelWindowStateLive, registry.panels.State(descriptor.WindowName))
}

func TestRegistryOpenTimeoutClosesIncompleteChildAndPreservesOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	registry.panelOpenTimeout = 0
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	var closed string
	registry.closeWindow = func(windowName string) bool {
		closed = windowName
		return true
	}

	registry.expirePanelOpen(descriptor.WindowName, snapshot.TransferID)

	require.Equal(t, descriptor.WindowName, closed)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
	require.Equal(t, 1, registry.Count())
}

func TestRegistryFocusesAuthorizesAndClosesAnOwnedPanelWindow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)

	var routed []string
	var focused []string
	var closed []string
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		routed = append(routed, target+":"+eventName)
		return true
	}
	registry.focusWindow = func(windowName string) bool {
		focused = append(focused, windowName)
		return true
	}
	registry.closeWindow = func(windowName string) bool {
		closed = append(closed, windowName)
		return true
	}

	panelID := snapshot.Tabs[0].PanelID
	require.NoError(t, registry.FocusPanelWindow(owner.Name(), descriptor.WindowName, panelID))
	require.NoError(t, registry.RequestPanelWindowClose(
		descriptor.WindowName, descriptor.WindowName, "user-close",
	))
	require.NoError(t, registry.AcknowledgePanelWindowClose(descriptor.WindowName))

	require.Equal(t, []string{descriptor.WindowName}, focused)
	require.Equal(t, []string{descriptor.WindowName}, closed)
	require.Equal(t, []string{
		descriptor.WindowName + ":" + panelwindow.WindowFocusRequestedEventName,
		descriptor.WindowName + ":" + panelwindow.WindowCloseRequestedEventName,
		owner.Name() + ":" + panelwindow.WindowClosedEventName,
		owner.Name() + ":" + panelwindow.WorkspaceChangedEventName,
	}, routed)
	_, err = registry.PanelDescriptor(descriptor.WindowName)
	require.ErrorContains(t, err, "not live")
}

func TestRegistryValidatesDockAcknowledgementBeforeClosingThePanelWindow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.showWindow = func(string) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	dock := snapshot
	dock.SourceWindowName = descriptor.WindowName
	dock.TransferID = "dock-transfer-1"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "right", dock))
	var closed []string
	registry.closeWindow = func(windowName string) bool {
		closed = append(closed, windowName)
		return true
	}

	err = registry.AcknowledgePanelWindowDock(owner.Name(), descriptor.WindowName, "stale-transfer")

	require.ErrorContains(t, err, "stale")
	require.Empty(t, closed)
	require.Equal(t, PanelWindowStateDocking, registry.panels.State(descriptor.WindowName))
}

func TestRegistrySerializesDockCommitAgainstTransferFailure(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.showWindow = func(string) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	dockSnapshot := snapshot
	dockSnapshot.SourceWindowName = descriptor.WindowName
	dockSnapshot.TransferID = "dock-transfer-serialized"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "right", dockSnapshot))
	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})
	registry.closeWindow = func(string) bool {
		close(closeStarted)
		<-releaseClose
		return true
	}
	acknowledged := make(chan error, 1)
	go func() {
		acknowledged <- registry.AcknowledgePanelWindowDock(
			owner.Name(), descriptor.WindowName, dockSnapshot.TransferID,
		)
	}()
	<-closeStarted
	failed := make(chan error, 1)
	go func() {
		failed <- registry.FailPanelWindowTransfer(
			owner.Name(), descriptor.WindowName, dockSnapshot.TransferID,
		)
	}()

	select {
	case err := <-failed:
		t.Fatalf("transfer failure raced ahead of dock commit: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(releaseClose)
	require.NoError(t, <-acknowledged)
	require.ErrorContains(t, <-failed, "not live")
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
}

func TestRegistryReportsAnOpeningTransferFailureToItsOwner(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.closeWindow = func(string) bool { return true }
	var closed panelwindow.WindowClosedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, owner.Name(), target)
		require.Equal(t, panelwindow.WindowClosedEventName, eventName)
		closed = payload.(panelwindow.WindowClosedEvent)
		return true
	}

	require.NoError(t, registry.FailPanelWindowTransfer(descriptor.WindowName, descriptor.WindowName, snapshot.TransferID))

	require.Equal(t, descriptor.WindowName, closed.WindowName)
	require.Equal(t, descriptor.ClusterID, closed.ClusterID)
	require.Equal(t, descriptor.GroupID, closed.GroupID)
}

func TestRegistryReportsAnOpeningTransferFailureWhenNativeWindowAlreadyDisappeared(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.closeWindow = func(string) bool { return false }
	var closed panelwindow.WindowClosedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, owner.Name(), target)
		require.Equal(t, panelwindow.WindowClosedEventName, eventName)
		closed = payload.(panelwindow.WindowClosedEvent)
		return true
	}

	err = registry.FailPanelWindowTransfer(
		descriptor.WindowName,
		descriptor.WindowName,
		snapshot.TransferID,
	)

	require.ErrorContains(t, err, "not available")
	require.Equal(t, descriptor.WindowName, closed.WindowName)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
}

func TestRegistryTreatsAnUncancelledWindowEventAsDelivered(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)

	require.True(t, registry.emitWindowEvent(
		owner.Name(),
		panelwindow.WindowClosedEventName,
		panelwindow.WindowClosedEvent{WindowName: "panel-1"},
	))
}

func TestRegistryAllowsAppCloseWhileClusterPanelWindowsRemainLive(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = source.Name()
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	var closed []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	require.NoError(t, registry.AcknowledgeWorkspaceWindowClose(source.Name()))
	require.Equal(t, []string{source.Name()}, closed)
	require.Equal(t, PanelWindowStateLive, registry.panels.State(descriptor.WindowName))
}

func TestRegistryRejectsPanelCommandsAcrossOwnerAndTransportBoundaries(t *testing.T) {
	setup := func(t *testing.T) (*Registry, string, PanelWindowDescriptor, PanelGroupSnapshot) {
		t.Helper()
		registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
		owner := registry.Create(true)
		snapshot := validPanelGroupSnapshot()
		snapshot.SourceWindowName = owner.Name()
		descriptor, err := beginTestPanelWindow(t, registry, snapshot)
		require.NoError(t, err)
		return registry, owner.Name(), descriptor, snapshot
	}

	t.Run("focus validates owner and both native operations", func(t *testing.T) {
		registry, owner, descriptor, snapshot := setup(t)
		require.ErrorContains(t, registry.FocusPanelWindow("workspace-other", descriptor.WindowName, snapshot.ActivePanelID), "does not display")
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.FocusPanelWindow(owner, descriptor.WindowName, snapshot.ActivePanelID), "not available")
		registry.emitWindowEvent = func(string, string, any) bool { return true }
		registry.focusWindow = func(string) bool { return false }
		require.ErrorContains(t, registry.FocusPanelWindow(owner, descriptor.WindowName, snapshot.ActivePanelID), "not available")
	})

	t.Run("menu routing permits only owner commands and requires owner delivery", func(t *testing.T) {
		registry, _, descriptor, _ := setup(t)
		require.ErrorContains(t, registry.RoutePanelWindowCommand(descriptor.WindowName, panelwindow.WorkspaceCommand("delete-object")), "cannot be routed")
		registry.focusWindow = func(string) bool { return false }
		require.ErrorContains(t, registry.RoutePanelWindowCommand(descriptor.WindowName, panelwindow.WorkspaceCommandOpenSettings), "not available")
		registry.focusWindow = func(string) bool { return true }
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.RoutePanelWindowCommand(descriptor.WindowName, panelwindow.WorkspaceCommandOpenSettings), "not available")
	})

	t.Run("snapshot and tab commands fail closed on invalid state or delivery", func(t *testing.T) {
		registry, _, descriptor, snapshot := setup(t)
		invalid := snapshot
		invalid.TransferID = ""
		require.Error(t, registry.UpdatePanelWindowSnapshot(descriptor.WindowName, invalid))
		require.ErrorContains(t, registry.RequestPanelTabClose(descriptor.WindowName, "panel-missing"), "not in window")
		registry.showWindow = func(string) bool { return true }
		registry.emitWindowEvent = func(string, string, any) bool { return true }
		_, err := registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
		require.NoError(t, err)
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		snapshot.SourceWindowName = descriptor.WindowName
		require.NoError(t, registry.UpdatePanelWindowSnapshot(descriptor.WindowName, snapshot))
		require.ErrorContains(t, registry.RequestPanelTabClose(descriptor.WindowName, snapshot.ActivePanelID), "not available")
	})

	t.Run("close requests require ownership and acknowledgements require a native target", func(t *testing.T) {
		registry, owner, descriptor, _ := setup(t)
		require.ErrorContains(t, registry.RequestPanelWindowClose("workspace-other", descriptor.WindowName, "close"), "cannot close")
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.RequestPanelWindowClose(owner, descriptor.WindowName, "close"), "not available")
		registry.closeWindow = func(string) bool { return false }
		require.ErrorContains(t, registry.AcknowledgePanelWindowClose(descriptor.WindowName), "not available")
	})

	t.Run("workspace close preserves live ownership", func(t *testing.T) {
		empty := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
		emptyOwner := empty.Create(true).Name()
		empty.closeWindow = func(string) bool { return false }
		require.ErrorContains(t, empty.AcknowledgeWorkspaceWindowClose(emptyOwner), "not available")
	})

}

func TestRegistryResolvesWorkspaceAndPanelRolesFromWindowName(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	owner := registry.Create(true)

	workspace, err := registry.WindowDescriptor(owner.Name())
	require.NoError(t, err)
	require.Equal(t, NativeWindowRoleWorkspace, workspace.Role)
	require.Equal(t, owner.Name(), workspace.Workspace.WindowName)
	require.Nil(t, workspace.Panel)

	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner.Name()
	created, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	panel, err := registry.WindowDescriptor(created.WindowName)
	require.NoError(t, err)
	require.Equal(t, NativeWindowRolePanel, panel.Role)
	require.Nil(t, panel.Workspace)
	require.Equal(t, created, *panel.Panel)

	_, err = registry.WindowDescriptor("window-missing")
	require.ErrorContains(t, err, "not registered")
}

func TestRegistryIndexesPanelWindowsByClusterAcrossAppViews(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{"workspace-1": {"cluster-1", "cluster-2"}, "workspace-2": {"cluster-1"}}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	first, second := registry.Create(true), registry.Create(false)
	create := func(source, cluster, group string) string {
		snapshot := validPanelGroupSnapshot()
		snapshot.SourceWindowName, snapshot.ClusterID, snapshot.GroupID, snapshot.TransferID = source, cluster, group, "transfer-"+group
		snapshot.Tabs[0].ObjectRef.ClusterID, snapshot.Tabs[0].ObjectRef.Name = cluster, group
		snapshot.Tabs[0].PanelID, snapshot.ActivePanelID = group, group
		descriptor, err := beginTestPanelWindow(t, registry, snapshot)
		require.NoError(t, err)
		return descriptor.WindowName
	}
	a := create(first.Name(), "cluster-1", "a")
	b := create(second.Name(), "cluster-1", "b")
	c := create(first.Name(), "cluster-2", "c")
	require.ElementsMatch(t, []string{a, b}, registry.panels.Names("cluster-1"))
	require.Equal(t, []string{c}, registry.panels.Names("cluster-2"))
}

func TestPrepareApplicationQuitAllowsAnUnconfiguredRegistry(t *testing.T) {
	var missing *Registry

	require.True(t, missing.PrepareApplicationQuit())
	require.True(t, (&Registry{}).PrepareApplicationQuit())
}

func TestPrepareApplicationQuitPreflightsEveryReadyWorkspaceBeforeClosingAny(t *testing.T) {
	wailsApp := application.New(application.Options{})
	backend := &recordingLifecycleBackend{allowQuit: true}
	registry := NewRegistry(wailsApp, backend)
	first := registry.Create(true)
	second := registry.Create(false)
	registry.markWorkspaceReady(first.Name())
	registry.markWorkspaceReady(second.Name())
	var requests []panelwindow.ApplicationQuitPreflightRequestedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, panelwindow.ApplicationQuitPreflightRequestedEventName, eventName)
		request := payload.(panelwindow.ApplicationQuitPreflightRequestedEvent)
		require.Equal(t, target, request.WindowName)
		requests = append(requests, request)
		return true
	}

	require.False(t, registry.PrepareApplicationQuit())
	require.Len(t, requests, 2)
	require.Equal(t, requests[0].TransactionID, requests[1].TransactionID)
	require.Empty(t, backend.preparedWindow)
	require.Equal(t, 2, registry.Count())
}

func TestApplicationQuitPreflightCommitsOnlyAfterEveryWorkspaceAllows(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{allowQuit: true})
	first := registry.Create(true)
	second := registry.Create(false)
	registry.markWorkspaceReady(first.Name())
	registry.markWorkspaceReady(second.Name())
	var transactionID string
	var closeRequests []string
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		switch eventName {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			transactionID = payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
		case panelwindow.WorkspaceCloseRequestedEventName:
			closeRequests = append(closeRequests, target)
		}
		return true
	}
	registry.closeWindow = func(name string) bool { closeRequests = append(closeRequests, name); return true }
	require.False(t, registry.PrepareApplicationQuit())

	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(first.Name(), transactionID, true))
	require.Empty(t, closeRequests)
	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(second.Name(), transactionID, true))
	require.ElementsMatch(t, []string{first.Name(), second.Name()}, closeRequests)
	require.False(t, registry.PrepareApplicationQuit())
}

func TestApplicationQuitPreflightCancellationLeavesEveryWorkspaceOpen(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{allowQuit: true})
	first := registry.Create(true)
	second := registry.Create(false)
	registry.markWorkspaceReady(first.Name())
	registry.markWorkspaceReady(second.Name())
	var transactionID string
	var closeRequests []string
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		if eventName == panelwindow.ApplicationQuitPreflightRequestedEventName {
			transactionID = payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
		}
		if eventName == panelwindow.WorkspaceCloseRequestedEventName {
			closeRequests = append(closeRequests, target)
		}
		return true
	}
	require.False(t, registry.PrepareApplicationQuit())

	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(first.Name(), transactionID, false))
	require.Empty(t, closeRequests)
	require.Equal(t, 2, registry.Count())
}

func TestApplicationQuitPreflightTimeoutAllowsAFreshTransaction(t *testing.T) {
	registry := NewRegistry(
		application.New(application.Options{}),
		&recordingLifecycleBackend{allowQuit: true},
	)
	owner := registry.Create(true)
	registry.markWorkspaceReady(owner.Name())
	registry.quitPreflightTimeout = time.Millisecond
	transactions := make(chan string, 2)
	registry.emitWindowEvent = func(_ string, eventName string, payload any) bool {
		if eventName == panelwindow.ApplicationQuitPreflightRequestedEventName {
			transactions <- payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
		}
		return true
	}

	require.False(t, registry.PrepareApplicationQuit())
	first := <-transactions
	require.Eventually(t, func() bool {
		registry.quitMu.Lock()
		defer registry.quitMu.Unlock()
		return registry.pendingQuit == nil
	}, time.Second, time.Millisecond)
	require.False(t, registry.PrepareApplicationQuit())
	second := <-transactions
	require.NotEqual(t, first, second)
}

func TestApplicationQuitPreflightDeliveryFailureAllowsAFreshTransaction(t *testing.T) {
	registry := NewRegistry(
		application.New(application.Options{}),
		&recordingLifecycleBackend{allowQuit: true},
	)
	owner := registry.Create(true)
	registry.markWorkspaceReady(owner.Name())
	deliver := false
	registry.emitWindowEvent = func(string, string, any) bool { return deliver }

	require.False(t, registry.PrepareApplicationQuit())
	registry.quitMu.Lock()
	require.Nil(t, registry.pendingQuit)
	registry.quitMu.Unlock()
	deliver = true
	require.False(t, registry.PrepareApplicationQuit())
	registry.quitMu.Lock()
	require.NotNil(t, registry.pendingQuit)
	registry.quitMu.Unlock()
}

func TestRegistryUsesItsLifecycleConsumerWithoutConcreteBackendOwnership(t *testing.T) {
	lifecycle := newLifecycle()
	first := lifecycle.Add()
	second := lifecycle.Add()
	backend := &recordingLifecycleBackend{allowQuit: true}
	registry := &Registry{backend: backend, lifecycle: lifecycle, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory()}

	registry.handleClosing(nil, first)
	require.Equal(t, first, backend.releasedWindow)
	require.Equal(t, second, lifecycle.MostRecent())

	require.True(t, registry.PrepareApplicationQuit())
	require.Equal(t, second, backend.preparedWindow)
}

func TestFocusMostRecentIgnoresAnEmptyRegistry(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})

	registry.FocusMostRecent()
}

func TestCascadedCoordinateKeepsWindowsInsideTheWorkArea(t *testing.T) {
	tests := []struct {
		name     string
		position int
		size     int
		limit    int
		want     int
	}{
		{name: "cascades forward", position: 10, size: 50, limit: 100, want: 34},
		{name: "reverses near the far edge", position: 50, size: 50, limit: 100, want: 26},
		{name: "clamps a negative position", position: -50, size: 100, limit: 120, want: 0},
		{name: "clamps beyond the far edge", position: 200, size: 50, limit: 100, want: 50},
		{name: "keeps position when neither offset fits", position: 10, size: 80, limit: 100, want: 10},
		{name: "clamps a window larger than the work area", position: 10, size: 120, limit: 100, want: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, cascadedCoordinate(test.position, test.size, test.limit))
		})
	}
}

// Native lifecycle fixtures start with panels already mounted in their source
// renderer. Invalid snapshots and unknown sources still reach the real boundary.
func beginTestPanelWindow(t *testing.T, registry *Registry, snapshot PanelGroupSnapshot) (PanelWindowDescriptor, error) {
	t.Helper()
	if panelwindow.ValidateGroupSnapshot(snapshot) == nil && registry.windowHasCluster(snapshot.SourceWindowName, snapshot.ClusterID) {
		for _, tab := range snapshot.Tabs {
			_, _, err := registry.workspace.Open(tab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: snapshot.SourceWindowName, GroupID: "right"})
			require.NoError(t, err)
		}
		require.NoError(t, registry.AcknowledgePanelWorkspaceReady(snapshot.SourceWindowName))
	}
	return registry.BeginPanelWindowOpen(snapshot)
}

func (b *recordingLifecycleBackend) StageClusterViewTransfer(source, target, clusterID string) (bool, error) {
	if b.windowClusters == nil {
		return true, nil
	}
	existing := b.windowClusters[target]
	for _, id := range existing {
		if id == clusterID {
			return true, nil
		}
	}
	b.windowClusters[target] = append(existing, clusterID)
	return false, nil
}
func (b *recordingLifecycleBackend) CommitClusterViewTransfer(source, target, clusterID string, groups []panelwindow.WorkspaceGroup) error {
	return b.PanelWorkspaceDirectory().TransferClusterView(source, target, clusterID, groups)
}
func (b *recordingLifecycleBackend) CancelClusterViewTransfer(target, clusterID string) error {
	if b.windowClusters == nil {
		return nil
	}
	var remaining []string
	for _, id := range b.windowClusters[target] {
		if id != clusterID {
			remaining = append(remaining, id)
		}
	}
	b.windowClusters[target] = remaining
	return nil
}
