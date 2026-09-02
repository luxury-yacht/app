package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type recordingLifecycleBackend struct {
	releasedWindow string
	preparedWindow string
	allowQuit      bool
	readyWindows   []string
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
			options := windowOptionsForPlatform("workspace-7", nil, test.goos)

			require.Equal(t, test.wantHidden, options.Hidden)
		})
	}
}

func TestOptionsPreserveTheSharedPeerContract(t *testing.T) {
	nativeMenu := application.NewMenu()

	for _, test := range []struct {
		goos               string
		wantBackgroundType application.BackgroundType
	}{
		{goos: "darwin", wantBackgroundType: application.BackgroundTypeTransparent},
		{goos: "windows", wantBackgroundType: application.BackgroundTypeSolid},
		{goos: "linux", wantBackgroundType: application.BackgroundTypeTransparent},
	} {
		t.Run(test.goos, func(t *testing.T) {
			options := windowOptionsForPlatform("workspace-7", nativeMenu, test.goos)

			require.Equal(t, "workspace-7", options.Name)
			require.Equal(t, "Luxury Yacht", options.Title)
			require.Equal(t, 1200, options.Width)
			require.Equal(t, 800, options.Height)
			require.Equal(t, 1100, options.MinWidth)
			require.Equal(t, 600, options.MinHeight)
			require.Zero(t, options.MaxWidth)
			require.Zero(t, options.MaxHeight)
			require.Equal(t, "/", options.URL)
			require.Equal(t, application.NewRGB(30, 30, 30), options.BackgroundColour)
			require.Equal(t, test.wantBackgroundType, options.BackgroundType)
			require.True(t, options.Mac.TitleBar.AppearsTransparent)
			require.True(t, options.Mac.TitleBar.FullSizeContent)
			require.True(t, options.Mac.TitleBar.HideTitle)
			require.True(t, options.Mac.TitleBar.HideToolbarSeparator)
			require.Equal(t, application.SystemDefault, options.Windows.Theme)
			require.Same(t, nativeMenu, options.Linux.Menu)
			require.True(t, options.UseApplicationMenu)
			require.Equal(t, 1.0, options.Zoom)
			require.False(t, options.ZoomControlEnabled)
			require.Equal(t, test.goos != "linux", options.Hidden)
		})
	}
}

func TestPanelOptionsUseSharedEntryAndPlatformNativeFrame(t *testing.T) {
	for _, test := range []struct {
		goos                string
		wantTitle           string
		wantApplicationMenu bool
		wantWindowsMenuOff  bool
	}{
		{goos: "darwin", wantApplicationMenu: true},
		{goos: "windows", wantWindowsMenuOff: true},
		{goos: "linux", wantTitle: " "},
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
			require.False(t, options.Frameless)
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
	registry := NewRegistry(wailsApp, nil, nil)
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
	snapshot.OwnerWindowName = owner.Name()
	snapshot.InitialBounds = &panelwindow.WindowBounds{X: 2900, Y: 700, Width: 720, Height: 560}

	_, err := registry.BeginPanelWindowOpen(snapshot)

	require.NoError(t, err)
	require.Equal(t, 2140, createdOptions.X)
	require.Equal(t, 150, createdOptions.Y)
	require.Equal(t, 720, createdOptions.Width)
	require.Equal(t, 560, createdOptions.Height)
}

func TestRegistryCentersPanelWindowWhenOwnerNativeGeometryIsUnavailable(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
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
	snapshot.OwnerWindowName = owner.Name()
	snapshot.InitialBounds = &panelwindow.WindowBounds{X: 2900, Y: 700, Width: 720, Height: 560}

	_, err := registry.BeginPanelWindowOpen(snapshot)

	require.NoError(t, err)
	require.Equal(t, application.WindowCentered, createdOptions.InitialPosition)
	require.Equal(t, 720, createdOptions.Width)
	require.Equal(t, 560, createdOptions.Height)
}

func TestRegistryUsesTearOffCursorPositionOnItsTargetScreen(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
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
	snapshot.OwnerWindowName = owner.Name()
	snapshot.UseInitialPosition = true
	snapshot.InitialBounds = &panelwindow.WindowBounds{X: 1805, Y: 76, Width: 600, Height: 800}
	snapshot.InitialPositionAnchor = &panelwindow.WindowPoint{X: 1925, Y: 100}

	_, err := registry.BeginPanelWindowOpen(snapshot)

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

	require.Equal(t, panelwindow.OwnerCloseRequestedEventName, eventName)
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
	registry := NewRegistry(wailsApp, nil, nil)

	require.Zero(t, registry.Count())
	first := registry.Create(true)
	second := registry.Create(false)

	require.Equal(t, "workspace-1", first.Name())
	require.Equal(t, "workspace-2", second.Name())
	require.Equal(t, 2, registry.Count())
}

func TestRegistryCreatesPanelOutsideWorkspaceLifecycleAccounting(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()

	panel, err := registry.BeginPanelWindowOpen(snapshot)

	require.NoError(t, err)
	require.Equal(t, "panel-1", panel.WindowName)
	require.Equal(t, 1, registry.Count())
}

func TestRegistryBeginsHiddenPanelTransferWithOrdinaryWindowOptions(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	var createdOptions application.WebviewWindowOptions
	var configuredWindow *application.WebviewWindow
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		createdOptions = options
		return application.NewWindow(options)
	}
	registry.configurePanelWindow = func(window *application.WebviewWindow) {
		configuredWindow = window
	}

	descriptor, err := registry.BeginPanelWindowOpen(snapshot)

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
	require.False(t, createdOptions.Frameless)
	require.True(t, createdOptions.Mac.TitleBar.FullSizeContent)
	require.NotNil(t, configuredWindow)
	require.Equal(t, descriptor.WindowName, configuredWindow.Name())
	require.Equal(t, 1, registry.Count())
}

func TestRegistryRejectsPanelWithUnknownOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = "workspace-missing"

	panel, err := registry.BeginPanelWindowOpen(snapshot)

	require.ErrorContains(t, err, "owner workspace")
	require.Empty(t, panel)
	require.Zero(t, registry.Count())
}

func TestRegistryRejectsIncompletePanelIdentity(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	valid := validPanelGroupSnapshot()
	valid.OwnerWindowName = owner.Name()

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
			panel, err := registry.BeginPanelWindowOpen(snapshot)

			require.Error(t, err)
			require.Empty(t, panel)
		})
	}
}

func TestRegistryRejectsDuplicatePanelGroupWithinOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	first, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	require.NotEmpty(t, first)

	duplicateSnapshot := snapshot
	duplicateSnapshot.TransferID = "transfer-2"
	duplicate, err := registry.BeginPanelWindowOpen(duplicateSnapshot)

	require.ErrorContains(t, err, "already owns panel group")
	require.Empty(t, duplicate)
	require.Equal(t, 1, registry.Count())
}

func TestAuthorizedPanelClosingHookLeavesCommitToTheRequestTransaction(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)

	registry.authorizeClose(descriptor.WindowName)
	registry.handlePanelClosingEvent(nil, descriptor.WindowName)

	stored, err := registry.PanelDescriptor(descriptor.WindowName)
	require.NoError(t, err)
	require.Equal(t, descriptor.WindowName, stored.WindowName)
}

func TestRegistryRoutesPanelMenuCommandsAndFocusesTheOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	var focused string
	registry.focusWindow = func(windowName string) bool {
		focused = windowName
		return true
	}
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		require.Equal(t, owner.Name(), target)
		require.Equal(t, "open-settings", eventName)
		return true
	}

	require.NoError(t, registry.RoutePanelWindowCommand(descriptor.WindowName, "open-settings"))
	require.Equal(t, owner.Name(), focused)
}

func TestRegistryShowsPanelOnlyAfterMatchingReadyAcknowledgement(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
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
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
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

func TestRegistryClosesReadyPanelWhenOpenedEventCannotReachOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	var closedNative string
	registry.closeWindow = func(name string) bool {
		closedNative = name
		return true
	}
	var closed panelwindow.WindowClosedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, owner.Name(), target)
		if eventName == panelwindow.WindowOpenedEventName {
			return false
		}
		require.Equal(t, panelwindow.WindowClosedEventName, eventName)
		closed = payload.(panelwindow.WindowClosedEvent)
		return true
	}

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)

	require.ErrorContains(t, err, "owner workspace")
	require.Equal(t, descriptor.WindowName, closedNative)
	require.Equal(t, descriptor.WindowName, closed.WindowName)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
}

func TestRegistryRoutesAcknowledgedOpenAndDockToTheImmutableOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	var events []struct {
		windowName string
		eventName  string
		payload    any
	}
	var closed []string
	registry.emitWindowEvent = func(windowName, eventName string, payload any) bool {
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
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, owner.Name(), events[0].windowName)
	require.Equal(t, PanelWindowOpenedEventName, events[0].eventName)

	dockSnapshot := snapshot
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
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)

	dockSnapshot := snapshot
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
	registry := NewRegistry(wailsApp, nil, nil)
	registry.panelOpenTimeout = 0
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
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

func TestRegistryRoutesChildObjectOpenThroughItsOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	registry.emitWindowEvent = func(windowName, eventName string, payload any) bool {
		require.Equal(t, owner.Name(), windowName)
		if eventName == PanelWindowObjectOpenRequestedEventName {
			request := payload.(PanelWindowObjectOpenRequestEvent)
			require.Equal(t, descriptor.WindowName, request.SourceWindowName)
		}
		return true
	}
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)

	ref := snapshot.Tabs[0].ObjectRef
	ref.Name = "worker"
	require.NoError(t, registry.RequestPanelObjectOpen(descriptor.WindowName, ref, "details"))
}

func TestRegistryRoutesSnapshotAndTabCloseThroughOwner(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)

	var routed []string
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		routed = append(routed, target+":"+eventName)
		return true
	}
	updated := snapshot
	updated.Tabs = append([]PanelTabSnapshot(nil), snapshot.Tabs...)
	updated.Tabs[0].ActiveView = "events"
	require.NoError(t, registry.UpdatePanelWindowSnapshot(descriptor.WindowName, updated))
	require.NoError(t, registry.RequestPanelTabClose(descriptor.WindowName, updated.Tabs[0].PanelID))
	require.NoError(t, registry.AuthorizePanelTabClose(
		owner.Name(), descriptor.WindowName, updated.Tabs[0].PanelID,
	))
	require.Equal(t, []string{
		owner.Name() + ":" + panelwindow.SnapshotUpdatedEventName,
		owner.Name() + ":" + panelwindow.TabCloseRequestedEventName,
		descriptor.WindowName + ":" + panelwindow.TabCloseAuthorizedEventName,
	}, routed)
}

func TestRegistryRoutesQuitGuardChecksBetweenOwnerAndPanel(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	var routed []string
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		routed = append(routed, target+":"+eventName)
		return true
	}

	require.NoError(t, registry.RequestPanelWindowGuard(
		owner.Name(), descriptor.WindowName, "guard-1", "application-quit",
	))
	require.NoError(t, registry.AcknowledgePanelWindowGuard(
		descriptor.WindowName, "guard-1", true,
	))
	require.Equal(t, []string{
		descriptor.WindowName + ":" + panelwindow.WindowGuardRequestedEventName,
		owner.Name() + ":" + panelwindow.WindowGuardResultEventName,
	}, routed)
}

func TestRegistryFocusesAuthorizesAndClosesAnOwnedPanelWindow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
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
	ref := snapshot.Tabs[0].ObjectRef
	require.NoError(t, registry.FocusPanelWindow(owner.Name(), descriptor.WindowName, panelID))
	require.NoError(t, registry.AuthorizePanelObjectOpen(
		owner.Name(), descriptor.WindowName, panelID, ref, "details",
	))
	require.NoError(t, registry.RequestPanelWindowClose(
		descriptor.WindowName, descriptor.WindowName, "user-close",
	))
	require.NoError(t, registry.AcknowledgePanelWindowClose(descriptor.WindowName))

	require.Equal(t, []string{descriptor.WindowName}, focused)
	require.Equal(t, []string{descriptor.WindowName}, closed)
	require.Equal(t, []string{
		descriptor.WindowName + ":" + panelwindow.WindowFocusRequestedEventName,
		descriptor.WindowName + ":" + panelwindow.ObjectOpenAuthorizedEventName,
		descriptor.WindowName + ":" + panelwindow.WindowCloseRequestedEventName,
		owner.Name() + ":" + panelwindow.WindowClosedEventName,
	}, routed)
	_, err = registry.PanelDescriptor(descriptor.WindowName)
	require.ErrorContains(t, err, "not live")
}

func TestRegistryValidatesDockAcknowledgementBeforeClosingThePanelWindow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.showWindow = func(string) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	dock := snapshot
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

func TestRegistryReportsAnOpeningTransferFailureToItsOwner(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
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
	registry := NewRegistry(application.New(application.Options{}), nil, nil)
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
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
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)

	require.True(t, registry.emitWindowEvent(
		owner.Name(),
		panelwindow.WindowClosedEventName,
		panelwindow.WindowClosedEvent{WindowName: "panel-1"},
	))
}

func TestRegistryBlocksOwnerCloseUntilPanelChildrenAcknowledge(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)
	createPanel := func(clusterID, groupID, transferID string) string {
		snapshot := validPanelGroupSnapshot()
		snapshot.OwnerWindowName = owner.Name()
		snapshot.ClusterID = clusterID
		snapshot.GroupID = groupID
		snapshot.TransferID = transferID
		snapshot.Tabs[0].ObjectRef.ClusterID = clusterID
		descriptor, err := registry.BeginPanelWindowOpen(snapshot)
		require.NoError(t, err)
		return descriptor.WindowName
	}
	clusterPanel := createPanel("cluster-1", "group-1", "transfer-1")
	otherPanel := createPanel("cluster-2", "group-2", "transfer-2")

	var requested []string
	var closed []string
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		if eventName == panelwindow.WindowCloseRequestedEventName {
			requested = append(requested, target)
		}
		return true
	}
	registry.closeWindow = func(windowName string) bool {
		closed = append(closed, windowName)
		return true
	}

	require.NoError(t, registry.RequestPanelWindowClose(owner.Name(), clusterPanel, "cluster-close"))
	require.Equal(t, []string{clusterPanel}, requested)
	require.ErrorContains(t, registry.AcknowledgeWorkspaceWindowClose(owner.Name()), "still has live")

	require.NoError(t, registry.RequestPanelWindowClose(owner.Name(), otherPanel, "cluster-close"))
	require.NoError(t, registry.AcknowledgePanelWindowClose(clusterPanel))
	require.NoError(t, registry.AcknowledgePanelWindowClose(otherPanel))
	require.NoError(t, registry.AcknowledgeWorkspaceWindowClose(owner.Name()))
	require.Equal(t, []string{clusterPanel, otherPanel, owner.Name()}, closed)
}

func TestRegistryRejectsPanelCommandsAcrossOwnerAndTransportBoundaries(t *testing.T) {
	setup := func(t *testing.T) (*Registry, string, PanelWindowDescriptor, PanelGroupSnapshot) {
		t.Helper()
		registry := NewRegistry(application.New(application.Options{}), nil, nil)
		owner := registry.Create(true)
		snapshot := validPanelGroupSnapshot()
		snapshot.OwnerWindowName = owner.Name()
		descriptor, err := registry.BeginPanelWindowOpen(snapshot)
		require.NoError(t, err)
		return registry, owner.Name(), descriptor, snapshot
	}

	t.Run("focus validates owner and both native operations", func(t *testing.T) {
		registry, owner, descriptor, snapshot := setup(t)
		require.ErrorContains(t, registry.FocusPanelWindow("workspace-other", descriptor.WindowName, snapshot.ActivePanelID), "not owned")
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.FocusPanelWindow(owner, descriptor.WindowName, snapshot.ActivePanelID), "not available")
		registry.emitWindowEvent = func(string, string, any) bool { return true }
		registry.focusWindow = func(string) bool { return false }
		require.ErrorContains(t, registry.FocusPanelWindow(owner, descriptor.WindowName, snapshot.ActivePanelID), "not available")
	})

	t.Run("menu routing permits only owner commands and requires owner delivery", func(t *testing.T) {
		registry, _, descriptor, _ := setup(t)
		require.ErrorContains(t, registry.RoutePanelWindowCommand(descriptor.WindowName, "delete-object"), "cannot be routed")
		registry.focusWindow = func(string) bool { return false }
		require.ErrorContains(t, registry.RoutePanelWindowCommand(descriptor.WindowName, "open-settings"), "not available")
		registry.focusWindow = func(string) bool { return true }
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.RoutePanelWindowCommand(descriptor.WindowName, "open-settings"), "not available")
	})

	t.Run("object open validates identity view owner cluster and delivery", func(t *testing.T) {
		registry, owner, descriptor, snapshot := setup(t)
		ref := snapshot.Tabs[0].ObjectRef
		invalid := ref
		invalid.Name = ""
		require.Error(t, registry.RequestPanelObjectOpen(descriptor.WindowName, invalid, "details"))
		require.ErrorContains(t, registry.RequestPanelObjectOpen(descriptor.WindowName, ref, ""), "active view")
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.RequestPanelObjectOpen(descriptor.WindowName, ref, "details"), "not available")
		require.Error(t, registry.AuthorizePanelObjectOpen(owner, descriptor.WindowName, "panel-a", invalid, "details"))
		wrongCluster := ref
		wrongCluster.ClusterID = "cluster-other"
		require.ErrorContains(t, registry.AuthorizePanelObjectOpen(owner, descriptor.WindowName, "panel-a", wrongCluster, "details"), "does not match")
		require.ErrorContains(t, registry.AuthorizePanelObjectOpen(owner, descriptor.WindowName, "panel-a", ref, "details"), "not available")
	})

	t.Run("snapshot and tab commands fail closed on invalid state or delivery", func(t *testing.T) {
		registry, owner, descriptor, snapshot := setup(t)
		invalid := snapshot
		invalid.TransferID = ""
		require.Error(t, registry.UpdatePanelWindowSnapshot(descriptor.WindowName, invalid))
		require.ErrorContains(t, registry.RequestPanelTabClose(descriptor.WindowName, "panel-missing"), "not owned")
		registry.showWindow = func(string) bool { return true }
		registry.emitWindowEvent = func(string, string, any) bool { return true }
		_, err := registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
		require.NoError(t, err)
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.UpdatePanelWindowSnapshot(descriptor.WindowName, snapshot), "not available")
		require.ErrorContains(t, registry.RequestPanelTabClose(descriptor.WindowName, snapshot.ActivePanelID), "not available")
		require.ErrorContains(t, registry.AuthorizePanelTabClose("workspace-other", descriptor.WindowName, snapshot.ActivePanelID), "not owned")
		require.ErrorContains(t, registry.AuthorizePanelTabClose(owner, descriptor.WindowName, snapshot.ActivePanelID), "not available")
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
		empty := NewRegistry(application.New(application.Options{}), nil, nil)
		emptyOwner := empty.Create(true).Name()
		empty.closeWindow = func(string) bool { return false }
		require.ErrorContains(t, empty.AcknowledgeWorkspaceWindowClose(emptyOwner), "not available")
	})

	t.Run("guard transactions reject malformed duplicate stale and unavailable routes", func(t *testing.T) {
		registry, owner, descriptor, _ := setup(t)
		require.ErrorContains(t, registry.RequestPanelWindowGuard(owner, descriptor.WindowName, "", "quit"), "requires request")
		require.ErrorContains(t, registry.RequestPanelWindowGuard("workspace-other", descriptor.WindowName, "guard-1", "quit"), "not owned")
		registry.emitWindowEvent = func(string, string, any) bool { return true }
		require.NoError(t, registry.RequestPanelWindowGuard(owner, descriptor.WindowName, "guard-1", "quit"))
		require.ErrorContains(t, registry.RequestPanelWindowGuard(owner, descriptor.WindowName, "guard-1", "quit"), "already exists")
		require.ErrorContains(t, registry.AcknowledgePanelWindowGuard("panel-other", "guard-1", true), "stale")
		registry.emitWindowEvent = func(string, string, any) bool { return false }
		require.ErrorContains(t, registry.AcknowledgePanelWindowGuard(descriptor.WindowName, "guard-1", true), "not available")
		require.ErrorContains(t, registry.RequestPanelWindowGuard(owner, descriptor.WindowName, "guard-2", "quit"), "not available")
	})
}

func TestRegistryResolvesWorkspaceAndPanelRolesFromWindowName(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	owner := registry.Create(true)

	workspace, err := registry.WindowDescriptor(owner.Name())
	require.NoError(t, err)
	require.Equal(t, NativeWindowRoleWorkspace, workspace.Role)
	require.Equal(t, owner.Name(), workspace.Workspace.WindowName)
	require.Nil(t, workspace.Panel)

	snapshot := validPanelGroupSnapshot()
	snapshot.OwnerWindowName = owner.Name()
	created, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	panel, err := registry.WindowDescriptor(created.WindowName)
	require.NoError(t, err)
	require.Equal(t, NativeWindowRolePanel, panel.Role)
	require.Nil(t, panel.Workspace)
	require.Equal(t, created, *panel.Panel)

	_, err = registry.WindowDescriptor("window-missing")
	require.ErrorContains(t, err, "not registered")
}

func TestRegistryIndexesPanelWindowsByOwnerAndCluster(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)
	ownerA := registry.Create(true)
	ownerB := registry.Create(false)

	create := func(owner, cluster, group, transfer string) string {
		snapshot := validPanelGroupSnapshot()
		snapshot.OwnerWindowName = owner
		snapshot.ClusterID = cluster
		snapshot.GroupID = group
		snapshot.TransferID = transfer
		snapshot.Tabs[0].ObjectRef.ClusterID = cluster
		descriptor, err := registry.BeginPanelWindowOpen(snapshot)
		require.NoError(t, err)
		return descriptor.WindowName
	}
	panelA1 := create(ownerA.Name(), "cluster-1", "group-1", "transfer-1")
	panelA2 := create(ownerA.Name(), "cluster-1", "group-2", "transfer-2")
	panelA3 := create(ownerA.Name(), "cluster-2", "group-3", "transfer-3")
	panelB1 := create(ownerB.Name(), "cluster-1", "group-1", "transfer-4")

	require.ElementsMatch(
		t,
		[]string{panelA1, panelA2, panelA3},
		registry.PanelNamesOwnedByWorkspace(ownerA.Name()),
	)
	require.Equal(
		t,
		[]string{panelB1},
		registry.PanelNamesOwnedByWorkspace(ownerB.Name()),
	)
}

func TestPrepareApplicationQuitAllowsAnUnconfiguredRegistry(t *testing.T) {
	var missing *Registry

	require.True(t, missing.PrepareApplicationQuit())
	require.True(t, (&Registry{}).PrepareApplicationQuit())
}

func TestPrepareApplicationQuitPreflightsEveryReadyWorkspaceBeforeClosingAny(t *testing.T) {
	wailsApp := application.New(application.Options{})
	backend := &recordingLifecycleBackend{allowQuit: true}
	registry := NewRegistry(wailsApp, backend, nil)
	first := registry.Create(true)
	second := registry.Create(false)
	registry.markWorkspaceReady(first.Name())
	registry.markWorkspaceReady(second.Name())
	var requests []panelwindow.ApplicationQuitPreflightRequestedEvent
	registry.emitWindowEvent = func(target, eventName string, payload any) bool {
		require.Equal(t, panelwindow.ApplicationQuitPreflightRequestedEventName, eventName)
		request := payload.(panelwindow.ApplicationQuitPreflightRequestedEvent)
		require.Equal(t, target, request.OwnerWindowName)
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
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{allowQuit: true}, nil)
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
		case panelwindow.OwnerCloseRequestedEventName:
			closeRequests = append(closeRequests, target)
		}
		return true
	}
	require.False(t, registry.PrepareApplicationQuit())

	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(first.Name(), transactionID, true))
	require.Empty(t, closeRequests)
	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(second.Name(), transactionID, true))
	require.ElementsMatch(t, []string{first.Name(), second.Name()}, closeRequests)
	require.False(t, registry.PrepareApplicationQuit())
}

func TestApplicationQuitPreflightCancellationLeavesEveryWorkspaceOpen(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{allowQuit: true}, nil)
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
		if eventName == panelwindow.OwnerCloseRequestedEventName {
			closeRequests = append(closeRequests, target)
		}
		return true
	}
	require.False(t, registry.PrepareApplicationQuit())

	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(first.Name(), transactionID, false))
	require.Empty(t, closeRequests)
	require.Equal(t, 2, registry.Count())
}

func TestRegistryUsesItsLifecycleConsumerWithoutConcreteBackendOwnership(t *testing.T) {
	lifecycle := newLifecycle()
	first := lifecycle.Add()
	second := lifecycle.Add()
	backend := &recordingLifecycleBackend{allowQuit: true}
	registry := &Registry{backend: backend, lifecycle: lifecycle}

	registry.handleClosing(nil, first)
	require.Equal(t, first, backend.releasedWindow)
	require.Equal(t, second, lifecycle.MostRecent())

	require.True(t, registry.PrepareApplicationQuit())
	require.Equal(t, second, backend.preparedWindow)
}

func TestFocusMostRecentIgnoresAnEmptyRegistry(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)

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
