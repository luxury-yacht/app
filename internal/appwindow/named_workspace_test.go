package appwindow

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func TestNamedWorkspaceRestoreKeepsCurrentWindowsWhenCloseIsDenied(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.emitWindowEvent = func(window, event string, data any) bool {
		if event == panelwindow.ApplicationQuitPreflightRequestedEventName {
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, false))
		}
		return true
	}
	err := r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{}},
	})
	require.ErrorIs(t, err, errNamedWorkspaceOpenCancelled)
	require.True(t, r.lifecycle.Contains(name))
	require.Nil(t, r.pendingQuit)
	require.False(t, errors.Is(err, context.DeadlineExceeded))
}

func TestNamedWorkspaceRestoreKeepsCurrentWindowsWhenStagingFails(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
	r.closeWindow = func(name string) bool { return false }
	r.emitWindowEvent = func(window, event string, data any) bool {
		if event == panelwindow.ApplicationQuitPreflightRequestedEventName {
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		}
		return true
	}
	err := r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: panelwindow.NamedWorkspaceGeometry{
			WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800},
		}}},
	})
	require.ErrorContains(t, err, "could not create app window")
	require.Equal(t, []string{name}, r.lifecycle.Names())
	require.Nil(t, r.pendingQuit)
	_, staged := r.workspaceRestoreSlots.Load("workspace-2")
	require.False(t, staged)
}

func TestNamedWorkspaceReplacesWindowsAfterDestinationAcknowledges(t *testing.T) {
	app := application.New(application.Options{})
	panel := validPanelGroupSnapshot()
	r := NewRegistry(app, &recordingLifecycleBackend{
		windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{panel.ClusterID},
	})
	source := r.Create(false).Name()
	// The fixture creates Wails window objects without running the native event loop.
	r.application = nil
	r.markWorkspaceReady(source)
	_, _, err := r.workspace.Open(panel.Tabs[0], panelwindow.PanelLocation{
		WindowName: source, GroupID: "right", Kind: panelwindow.PanelLocationDocked, Active: true,
	})
	require.NoError(t, err)
	newWindow := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		require.True(t, options.Hidden)
		require.True(t, r.lifecycle.Contains(source))
		window := newWindow(options)
		if options.Name == "panel-1" {
			descriptor, err := r.PanelDescriptor(options.Name)
			require.NoError(t, err)
			require.Equal(t, panel.Tabs, descriptor.Group.Tabs)
			_, err = r.AcknowledgePanelWindowReady(options.Name, descriptor.TransferID)
			require.NoError(t, err)
		} else {
			require.NoError(t, r.AcknowledgePanelWorkspaceReady(options.Name))
		}
		return window
	}
	r.emitWindowEvent = func(window, event string, data any) bool {
		switch event {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.True(t, request.SwitchingWorkspace)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		case panelwindow.NamedWorkspaceRestoreRequested:
			request := data.(panelwindow.NamedWorkspaceRestoreRequest)
			require.Equal(t, "workspace-2", request.WindowName)
			require.True(t, r.lifecycle.Contains(source))
			require.NotSame(t, r.workspace, r.workspaceDirectoryFor(window))
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, ""))
		}
		return true
	}
	var shown []string
	r.showWindow = func(window string) bool { shown = append(shown, window); return true }
	r.closeWindow = func(window string) bool { r.handleClosing(nil, window); return true }
	restored := map[string]panelwindow.NamedWorkspaceGeometry{}
	var restoreOrder []string
	r.restoreWindowState = func(window string, state panelwindow.NamedWorkspaceGeometry) {
		restored[window] = state
		restoreOrder = append(restoreOrder, window)
	}
	bounds := panelwindow.WindowBounds{Width: 1100, Height: 800}
	fullscreen := panelwindow.NamedWorkspaceGeometry{WindowBounds: bounds, Fullscreen: true}
	minimized := panelwindow.NamedWorkspaceGeometry{WindowBounds: bounds, Minimized: true}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: fullscreen}},
		PanelWindows: []panelwindow.NamedWorkspacePanelWindow{{Geometry: minimized, Group: panelwindow.WorkspaceGroup{
			ClusterID: panel.ClusterID, GroupID: panel.GroupID, Tabs: panel.Tabs, ActivePanelID: panel.ActivePanelID,
		}}},
	}))
	require.Equal(t, []string{"workspace-2", "panel-1"}, shown)
	// Each window returns to the state it was saved in, not only to its bounds.
	require.Equal(t, map[string]panelwindow.NamedWorkspaceGeometry{"workspace-2": fullscreen, "panel-1": minimized}, restored)
	// A fullscreen transition takes over the display while it runs: a window
	// maximized during it is left part-way. Fullscreen is entered last.
	require.Equal(t, []string{"panel-1", "workspace-2"}, restoreOrder)
	require.Equal(t, []string{"workspace-2"}, r.lifecycle.Names())
	require.Same(t, r.workspace, r.workspaceDirectoryFor("workspace-2"))
	require.Equal(t, "panel-1", r.workspace.Snapshot(panel.ClusterID).Panels[0].Location.WindowName)
	require.Nil(t, r.pendingQuit)
}

func TestNamedWorkspaceMissingClusterPreservesAvailableViews(t *testing.T) {
	snapshot := panelwindow.NamedWorkspace{AppWindows: []panelwindow.NamedWorkspaceAppWindow{{NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
		SelectedClusterID: "missing",
		ClusterTabs:       []panelwindow.NamedWorkspaceClusterTab{{ClusterID: "missing"}, {ClusterID: "available"}},
		GlobalView:        &panelwindow.NamedWorkspaceGlobalView{View: "fleet"},
	}}, {NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
		SelectedClusterID: "missing",
		ClusterTabs:       []panelwindow.NamedWorkspaceClusterTab{{ClusterID: "missing"}},
	}}, {}}, PanelWindows: []panelwindow.NamedWorkspacePanelWindow{{Group: panelwindow.WorkspaceGroup{ClusterID: "missing"}}}}
	restored, missing := availableWorkspaceLayout(snapshot, []string{"available"})
	require.Equal(t, []string{"missing"}, missing)
	require.Equal(t, "available", restored.AppWindows[0].SelectedClusterID)
	require.Equal(t, []string{"available"}, workspaceClusterIDs(restored.AppWindows[0]))
	require.Nil(t, restored.AppWindows[0].GlobalView)
	require.Empty(t, restored.PanelWindows)
	require.Len(t, snapshot.AppWindows[0].ClusterTabs, 2)
	// A window that showed only missing clusters has nothing left to show. A
	// window saved without clusters is still part of the arrangement.
	require.Len(t, restored.AppWindows, 2)
	require.Empty(t, restored.AppWindows[1].ClusterTabs)
}

func TestCaptureNamedWorkspaceWaitsForEveryAppWindow(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	first, second := registry.lifecycle.Add(), registry.lifecycle.Add()
	registry.markWorkspaceReady(first)
	registry.windowGeometry = func(name string) (geometry, bool) {
		return geometry{Width: 1300, Height: 700}, true
	}
	var requested []string
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		requested = append(requested, name)
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		require.Error(t, registry.SubmitNamedWorkspaceCapture(name, "stale-id", panelwindow.NamedWorkspaceAppView{}, ""))
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, panelwindow.NamedWorkspaceAppView{}, ""))
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.Error(t, err)
	require.Empty(t, requested)
	registry.markWorkspaceReady(second)
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.NoError(t, err)
	require.Equal(t, []string{first, second}, requested)
	require.Len(t, workspace.AppWindows, 2)
	require.Equal(t, 1300, workspace.AppWindows[1].Geometry.Width)
}

func TestCaptureNamedWorkspaceRejectsAWindowClosingDuringCapture(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	first, second := registry.lifecycle.Add(), registry.lifecycle.Add()
	registry.markWorkspaceReady(first)
	registry.markWorkspaceReady(second)
	registry.windowGeometry = func(string) (geometry, bool) {
		return geometry{Width: 900, Height: 700}, true
	}
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, panelwindow.NamedWorkspaceAppView{}, ""))
		if name == second {
			registry.lifecycle.BeginClose(second)
		}
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.ErrorContains(t, err, "windows changed")
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.NoError(t, err)
	require.Len(t, workspace.AppWindows, 1)
}

func TestCaptureNamedWorkspaceKeepsDockedAndFloatingPanels(t *testing.T) {
	snapshot := twoTabPanelGroupSnapshot()
	registry, panel := liveNativeWindow(t, snapshot)
	app := registry.lifecycle.Add()
	registry.markWorkspaceReady(app)
	registry.backend = &recordingLifecycleBackend{windowClusters: map[string][]string{app: {snapshot.ClusterID}}}
	registry.windowGeometry = func(name string) (geometry, bool) {
		return geometry{AbsoluteX: -100, Width: 900, Height: 700}, true
	}
	dockedTab := snapshot.Tabs[0]
	dockedTab.PanelID = "dock-tab"
	dockedTab.ObjectRef.Name = "docked-object"
	_, _, err := registry.workspace.Open(dockedTab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: app, GroupID: "right", Active: true})
	require.NoError(t, err)
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		state := panelwindow.NamedWorkspaceAppView{}
		if name == app {
			state.ClusterTabs = []panelwindow.NamedWorkspaceClusterTab{{ClusterID: snapshot.ClusterID}}
			state.DockedGroups = []panelwindow.NamedWorkspaceDockedGroup{{Group: panelwindow.WorkspaceGroup{
				GroupID: "right", ClusterID: snapshot.ClusterID, ActivePanelID: dockedTab.PanelID, Tabs: []panelwindow.TabSnapshot{dockedTab},
			}}}
		} else {
			require.Equal(t, panel, name)
		}
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, state, ""))
		return true
	}
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), app)
	require.NoError(t, err)
	require.Equal(t, []panelwindow.TabSnapshot{dockedTab}, workspace.AppWindows[0].DockedGroups[0].Group.Tabs)
	require.Equal(t, snapshot.Tabs, workspace.PanelWindows[0].Group.Tabs)
	require.Equal(t, -100, workspace.PanelWindows[0].Geometry.X)
}

// A collection timeout that fired as the last window approved is still waiting
// to run. It must not release the frozen windows while the switch is staging.
func TestNamedWorkspaceApprovalOutlivesItsCollectionTimeout(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
	r.closeWindow = func(string) bool { return false }
	var released []string
	r.emitWindowEvent = func(window, event string, data any) bool {
		switch event {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			collected := r.pendingQuit
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
			r.expireApplicationQuitPreflight(collected)
			require.Empty(t, released, "the approved switch keeps its windows frozen")
			require.NotNil(t, r.pendingQuit, "quit stays blocked while the switch stages")
		case panelwindow.ApplicationQuitPreflightSettledEventName:
			released = append(released, window)
		}
		return true
	}
	err := r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: panelwindow.NamedWorkspaceGeometry{
			WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800},
		}}},
	})
	require.ErrorContains(t, err, "could not create app window")
	require.Equal(t, []string{name}, released, "a failed switch releases the windows it froze")
	require.Nil(t, r.pendingQuit)
}

// A window that cannot report its view ends the capture with its reason, so the
// save fails at once instead of at the capture deadline.
func TestCaptureNamedWorkspaceReportsAWindowsFailure(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	name := registry.lifecycle.Add()
	registry.markWorkspaceReady(name)
	registry.windowGeometry = func(string) (geometry, bool) {
		return geometry{Width: 900, Height: 700}, true
	}
	failure := "table state could not be read"
	registry.emitWindowEvent = func(window, _ string, payload any) bool {
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(window, request.ID, panelwindow.NamedWorkspaceAppView{}, failure))
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), name)
	require.ErrorContains(t, err, failure)
	failure = ""
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), name)
	require.NoError(t, err)
	require.Len(t, workspace.AppWindows, 1)
}

// A workspace with nothing left to restore is refused before any open window is
// asked to pass its close guards.
func TestNamedWorkspaceWithNothingRestorableLeavesWindowsUnguarded(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{availableWorkspaceClusters: []string{"available"}})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.emitWindowEvent = func(window, event string, _ any) bool {
		t.Errorf("window %q received %q", window, event)
		return true
	}
	err := r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
			SelectedClusterID: "missing",
			ClusterTabs:       []panelwindow.NamedWorkspaceClusterTab{{ClusterID: "missing"}},
		}}},
		PanelWindows: []panelwindow.NamedWorkspacePanelWindow{{Group: panelwindow.WorkspaceGroup{ClusterID: "missing"}}},
	})
	require.ErrorContains(t, err, "missing")
	require.Nil(t, r.pendingQuit)
	require.Equal(t, []string{name}, r.lifecycle.Names())
}

// A floating panel window follows its own moves, so saving it while it is
// maximized, fullscreen, or minimized keeps the bounds it returns to and the
// state it was in.
func TestPanelWindowOutOfItsNormalStateIsSavedWithTheBoundsItReturnsTo(t *testing.T) {
	returnsTo := panelwindow.WindowBounds{X: 40, Y: 60, Width: 700, Height: 440}
	states := map[string]struct {
		current    geometry
		neverMoved bool
		saved      panelwindow.NamedWorkspaceGeometry
	}{
		"maximized":  {current: geometry{Width: 1728, Height: 1080, Maximised: true}, saved: panelwindow.NamedWorkspaceGeometry{WindowBounds: returnsTo, Maximized: true}},
		"fullscreen": {current: geometry{Width: 1728, Height: 1117, Fullscreen: true}, saved: panelwindow.NamedWorkspaceGeometry{WindowBounds: returnsTo, Fullscreen: true}},
		"minimized":  {current: geometry{AbsoluteX: -32000, AbsoluteY: -32000, Width: 160, Height: 28, Minimised: true}, saved: panelwindow.NamedWorkspaceGeometry{WindowBounds: returnsTo, Minimized: true}},
		// macOS reports a fullscreen window as zoomed too. Reopening it maximized
		// first would leave fullscreen onto a maximized window.
		"fullscreen reported as maximized": {current: geometry{Width: 1728, Height: 1117, Fullscreen: true, Maximised: true}, saved: panelwindow.NamedWorkspaceGeometry{WindowBounds: returnsTo, Fullscreen: true}},
		// Windows reports a minimized window as a sliver far off screen. With no
		// normal bounds to fall back on, the saved size is still one the window can have.
		"minimized before it was ever normal": {
			current: geometry{AbsoluteX: -32000, AbsoluteY: -32000, Width: 160, Height: 28, Minimised: true}, neverMoved: true,
			saved: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{X: -32000, Y: -32000, Width: panelWindowMinWidth, Height: panelWindowMinHeight}, Minimized: true},
		},
	}
	for name, state := range states {
		t.Run(name, func(t *testing.T) {
			app := application.New(application.Options{})
			registry, panel := liveNativeWindow(t, validPanelGroupSnapshot())
			window := app.Window.NewWithOptions(application.WebviewWindowOptions{Name: panel, Hidden: true})
			var mu sync.Mutex
			current := geometry{AbsoluteX: 40, AbsoluteY: 60, Width: 700, Height: 440}
			registry.windowGeometry = func(string) (geometry, bool) {
				mu.Lock()
				defer mu.Unlock()
				return current, true
			}
			registry.registerPanelLifecycleHooks(window, panel)
			if !state.neverMoved {
				window.HandleWindowEvent(uint(events.Common.WindowDidMove))
				require.Eventually(t, func() bool {
					_, tracked := registry.normalWorkspaceBounds.Load(panel)
					return tracked
				}, time.Second, time.Millisecond, "a panel window move is remembered")
			}
			mu.Lock()
			current = state.current
			mu.Unlock()
			saved, err := registry.captureNamedPanelWindow(panel)
			require.NoError(t, err)
			require.Equal(t, state.saved, saved.Geometry)
		})
	}
}

// The switch is committed once the new windows own the panel directory. A
// previous window that then fails to close is reported, the new windows stay,
// and nothing of the previous window is left for a later save or switch to wait on.
func TestNamedWorkspaceReportsPreviousWindowsThatDidNotClose(t *testing.T) {
	app := application.New(application.Options{})
	floating := validPanelGroupSnapshot()
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	r := NewRegistry(app, backend)
	source := r.Create(false).Name()
	// The fixture creates Wails window objects without running the native event loop.
	r.application = nil
	r.markWorkspaceReady(source)
	previous, err := r.panels.BeginOpen(floating)
	require.NoError(t, err)
	_, err = r.panels.AcknowledgeOpen(previous.WindowName, floating.TransferID)
	require.NoError(t, err)
	seedNativeGroup(t, r.workspace, previous.WindowName, floating)
	newWindow := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		window := newWindow(options)
		require.NoError(t, r.AcknowledgePanelWorkspaceReady(options.Name))
		return window
	}
	r.emitWindowEvent = func(window, event string, data any) bool {
		switch event {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		case panelwindow.NamedWorkspaceRestoreRequested:
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, ""))
		}
		return true
	}
	r.showWindow = func(string) bool { return true }
	r.restoreWindowState = func(string, panelwindow.NamedWorkspaceGeometry) {}
	var closes []string
	r.closeWindow = func(window string) bool { closes = append(closes, window); return false }

	err = r.OpenNamedWorkspace(context.Background(), source, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: panelwindow.NamedWorkspaceGeometry{
			WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800},
		}}},
	})

	require.ErrorContains(t, err, source)
	require.ErrorContains(t, err, previous.WindowName)
	require.Equal(t, []string{previous.WindowName, source}, closes, "only the previous windows are asked to close")
	require.Equal(t, []string{"workspace-2"}, r.lifecycle.Names())
	require.Same(t, r.workspace, r.workspaceDirectoryFor("workspace-2"))
	require.Empty(t, r.panels.Names(""))
	require.Contains(t, backend.releasedPanelReferences, previous.WindowName)
	require.Nil(t, r.pendingQuit)
}

// A switch can be cancelled while its last window is approving. Whichever lands
// first, the windows the switch froze are released and quit is not left blocked.
func TestCancelledWorkspaceSwitchNeverLeavesItsWindowsFrozen(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	var settled atomic.Int64
	r.emitWindowEvent = func(_, event string, _ any) bool {
		if event == panelwindow.ApplicationQuitPreflightSettledEventName {
			settled.Add(1)
		}
		return true
	}
	for attempt := range 20000 {
		guard, err := r.beginWorkspaceReplacement(name, []string{name})
		require.NoError(t, err)
		start := make(chan struct{})
		var racing sync.WaitGroup
		racing.Add(2)
		go func() {
			defer racing.Done()
			<-start
			// A stale-transaction rejection is the losing approval's expected answer.
			_ = r.AcknowledgeApplicationQuitPreflight(name, guard.transactionID, true)
		}()
		go func() {
			defer racing.Done()
			<-start
			r.endWorkspaceReplacement(guard.transactionID)
		}()
		close(start)
		racing.Wait()
		r.quitMu.Lock()
		stuck := r.pendingQuit
		r.quitMu.Unlock()
		require.Nilf(t, stuck, "attempt %d left an approved switch pending with nothing to end it", attempt)
		require.EqualValuesf(t, attempt+1, settled.Load(), "attempt %d must release its window exactly once", attempt)
	}
}

// A previous window whose close is refused stays a live window. It is reported
// as still open and its native window is left alone.
func TestReplacedAppWindowThatRefusesItsCloseIsReportedAsStillOpen(t *testing.T) {
	// With no other window or panel left, closing this one would quit, and the
	// backend refuses the quit.
	r := NewRegistry(nil, &recordingLifecycleBackend{allowQuit: false})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.emitWindowEvent = func(string, string, any) bool { return true }
	r.closeWindow = func(window string) bool {
		t.Errorf("window %q refused its close and must not be closed natively", window)
		return true
	}
	err := r.retireReplacedWindows([]string{name}, nil, nil)
	require.ErrorContains(t, err, name)
	require.ErrorContains(t, err, "stays open")
	require.Equal(t, []string{name}, r.lifecycle.Names())
	require.False(t, r.consumeAuthorizedClose(name), "no close authorization is left behind")
}
