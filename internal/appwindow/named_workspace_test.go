package appwindow

import (
	"context"
	"errors"
	"fmt"
	"slices"
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
	readyAppWindow(r, name)
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

func TestNamedWorkspaceKeepsCurrentWindowsWhenNoSavedWindowCanBeCreated(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	readyAppWindow(r, name)
	panel := validPanelGroupSnapshot()
	_, _, err := r.workspace.Open(panel.Tabs[0], panelwindow.PanelLocation{
		WindowName: name, GroupID: "right", Kind: panelwindow.PanelLocationDocked, Active: true,
	})
	require.NoError(t, err)
	var told []string
	r.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
	r.closeWindow = func(name string) bool { return false }
	r.emitWindowEvent = func(window, event string, data any) bool {
		if event == panelwindow.WorkspaceChangedEventName {
			told = append(told, window)
		}
		if event == panelwindow.ApplicationQuitPreflightRequestedEventName {
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		}
		return true
	}
	err = r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: panelwindow.NamedWorkspaceGeometry{
			WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800},
		}}},
	})
	require.Error(t, err)
	// The panel directory was already handed over, so the window that stays
	// must be told its panels are gone.
	require.Equal(t, []string{name}, told)
	require.Equal(t, []string{name}, r.lifecycle.Names(), "with nothing to replace them, the current windows stay")
	require.Nil(t, r.pendingQuit)
	require.Nil(t, r.activeRestore.Load())
}

func TestNamedWorkspaceReplacesAppAndPanelWindows(t *testing.T) {
	app := application.New(application.Options{})
	panel := validPanelGroupSnapshot()
	r := NewRegistry(app, &recordingLifecycleBackend{
		windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{panel.ClusterID},
	})
	source := r.Create(false).Name()
	// The fixture creates Wails window objects without running the native event loop.
	r.application = nil
	readyAppWindow(r, source)
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
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, ""))
		}
		return true
	}
	var shown []string
	r.showWindow = func(window string) bool { shown = append(shown, window); return true }
	r.closeWindow = func(window string) bool { r.handleClosing(nil, window); return true }
	restored := map[string]panelwindow.NamedWorkspaceGeometry{}
	var restoreOrder []string
	r.restoreWindowState = func(window string, state panelwindow.NamedWorkspaceGeometry) bool {
		restored[window] = state
		restoreOrder = append(restoreOrder, window)
		return true
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
	readyAppWindow(registry, first)
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
	readyAppWindow(registry, second)
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.NoError(t, err)
	require.Equal(t, []string{first, second}, requested)
	require.Len(t, workspace.AppWindows, 2)
	require.Equal(t, 1300, workspace.AppWindows[1].Geometry.Width)
}

func TestCaptureNamedWorkspaceRejectsAWindowClosingDuringCapture(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	first, second := registry.lifecycle.Add(), registry.lifecycle.Add()
	readyAppWindow(registry, first)
	readyAppWindow(registry, second)
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
	require.Error(t, err)
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.NoError(t, err)
	require.Len(t, workspace.AppWindows, 1)
}

func TestCaptureNamedWorkspaceKeepsDockedAndFloatingPanels(t *testing.T) {
	snapshot := twoTabPanelGroupSnapshot()
	registry, panel := liveNativeWindow(t, snapshot)
	app := registry.lifecycle.Add()
	readyAppWindow(registry, app)
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
// to run. It must not release the frozen windows while the switch is running.
func TestNamedWorkspaceApprovalOutlivesItsCollectionTimeout(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	readyAppWindow(r, name)
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
			require.NotNil(t, r.pendingQuit, "quit stays blocked while the switch runs")
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
	require.Error(t, err)
	require.Equal(t, []string{name}, released, "a failed switch releases the windows it froze")
	require.Nil(t, r.pendingQuit)
}

// A window that cannot report its view ends the capture with its reason, so the
// save fails at once instead of at the capture deadline.
func TestCaptureNamedWorkspaceReportsAWindowsFailure(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	name := registry.lifecycle.Add()
	readyAppWindow(registry, name)
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
	readyAppWindow(r, name)
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
	readyAppWindow(r, source)
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
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	r.emitWindowEvent = func(window, event string, data any) bool {
		switch event {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		case panelwindow.NamedWorkspaceRestoreRequested:
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, ""))
		case panelwindow.NamedWorkspaceWarnings:
			warnings = append(warnings, data.(panelwindow.NamedWorkspaceWarningsEvent))
		}
		return true
	}
	r.showWindow = func(string) bool { return true }
	r.restoreWindowState = func(string, panelwindow.NamedWorkspaceGeometry) bool { return true }
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
	require.Empty(t, r.panels.Names(""))
	require.Contains(t, backend.releasedPanelReferences, previous.WindowName)
	require.Nil(t, r.pendingQuit)
	// Neither previous window is still on screen, so the user is not warned.
	require.Empty(t, warnings)
}

// A switch can be cancelled while its last window is approving. Whichever lands
// first, the windows the switch froze are released and quit is not left blocked.
func TestCancelledWorkspaceSwitchNeverLeavesItsWindowsFrozen(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	readyAppWindow(r, name)
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

// switchRegistry returns a registry with one ready app window. Destinations of a
// switch acknowledge as soon as they are created, and every window approves the
// switch. warnings collects what the switch tells its restored windows.
func switchRegistry(t *testing.T, backend *recordingLifecycleBackend, warnings *[]panelwindow.NamedWorkspaceWarningsEvent) (*Registry, string) {
	t.Helper()
	r := NewRegistry(application.New(application.Options{}), backend)
	source := r.Create(false).Name()
	// The fixture creates Wails window objects without running the native event loop.
	r.application = nil
	readyAppWindow(r, source)
	newWindow := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		window := newWindow(options)
		if descriptor, err := r.PanelDescriptor(options.Name); err == nil {
			_, err = r.AcknowledgePanelWindowReady(options.Name, descriptor.TransferID)
			require.NoError(t, err)
		} else {
			// The runtime-ready hook marks a real app window ready.
			readyAppWindow(r, options.Name)
			require.NoError(t, r.AcknowledgePanelWorkspaceReady(options.Name))
		}
		return window
	}
	r.emitWindowEvent = func(window, event string, data any) bool {
		switch event {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		case panelwindow.NamedWorkspaceRestoreRequested:
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, ""))
		case panelwindow.NamedWorkspaceWarnings:
			*warnings = append(*warnings, data.(panelwindow.NamedWorkspaceWarningsEvent))
		}
		return true
	}
	r.showWindow = func(string) bool { return true }
	r.restoreWindowState = func(string, panelwindow.NamedWorkspaceGeometry) bool { return true }
	r.namedWorkspaceRestoreTimeout = 200 * time.Millisecond
	// A close the registry asked for must pass the window's own close hook.
	r.closeWindow = func(window string) bool {
		event := application.NewWindowEvent()
		if _, err := r.panels.Descriptor(window); err == nil {
			r.handlePanelClosingEvent(event, window)
		} else {
			r.handleClosing(event, window)
		}
		require.Falsef(t, event.IsCancelled(), "the registry's own close of %q was refused", window)
		return true
	}
	return r, source
}

func oneAppWindowWorkspace(clusters ...string) panelwindow.NamedWorkspace {
	view := panelwindow.NamedWorkspaceAppView{}
	for _, cluster := range clusters {
		view.ClusterTabs = append(view.ClusterTabs, panelwindow.NamedWorkspaceClusterTab{ClusterID: cluster})
		view.SelectedClusterID = clusters[0]
	}
	return panelwindow.NamedWorkspace{AppWindows: []panelwindow.NamedWorkspaceAppWindow{{
		Geometry:              panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800}},
		NamedWorkspaceAppView: view,
	}}}
}

// Save and switch ask every window, so a window whose renderer cannot answer
// yet would make them wait out a deadline. They refuse to start instead, and
// ask nobody.
func TestSaveAndSwitchWaitForARendererThatCanAnswer(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	ready, opening := r.lifecycle.Add(), r.lifecycle.Add()
	readyAppWindow(r, ready)
	// The native window exists, but its renderer has not subscribed yet.
	r.markWorkspaceReady(opening)
	r.windowGeometry = func(string) (geometry, bool) { return geometry{Width: 1300, Height: 700}, true }
	r.emitWindowEvent = func(window, event string, _ any) bool {
		t.Errorf("window %q was sent %q before every renderer could answer", window, event)
		return true
	}
	_, err := r.CaptureNamedWorkspace(context.Background(), ready)
	require.Error(t, err)
	require.Error(t, r.OpenNamedWorkspace(context.Background(), ready, oneAppWindowWorkspace()))
	require.Nil(t, r.pendingQuit)
}

// Only a previous window that is still on screen is something the user can act
// on. One that turned out to have no native window is cleaned up and logged.
func TestCommittedSwitchWarnsOnlyAboutPreviousWindowsStillOpen(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	restored := r.lifecycle.Add()
	readyAppWindow(r, restored)
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	r.emitWindowEvent = func(_, _ string, data any) bool {
		warnings = append(warnings, data.(panelwindow.NamedWorkspaceWarningsEvent))
		return true
	}
	restore := &namedWorkspaceRestore{targets: []namedWorkspaceTarget{{name: restored}}}
	stillOpen := fmt.Errorf("app window %q could not be closed: %w", "workspace-9", errReplacedWindowStaysOpen)
	gone := errors.New(`panel window "panel-4" had no native window to close`)

	require.Error(t, r.reportOpenedWorkspace(restore, nil, []error{gone}), "the failed close is still reported to the caller")
	require.Empty(t, warnings, "nothing is left open, so there is nothing to warn about")
	require.Error(t, r.reportOpenedWorkspace(restore, nil, []error{gone, stillOpen}))
	require.Equal(t, []panelwindow.NamedWorkspaceWarningsEvent{{WindowName: restored, UnclosedWindows: 1}}, warnings)
}

// The warning has to appear where the user is looking: not in a window that was
// reopened minimized, and in the fullscreen window that took over the display
// when there is one. A window that cannot take it passes it to the next.
func TestSwitchWarningGoesToAWindowTheUserCanSee(t *testing.T) {
	missing := []string{"missing"}
	cases := map[string]struct {
		targets     []namedWorkspaceTarget
		closed      []string
		unreachable []string
		answered    []string
		expected    []string
	}{
		// A window that has not loaded has no listener for the warning yet.
		"prefers a window that has loaded": {
			targets: []namedWorkspaceTarget{{}, {}}, answered: []string{"workspace-2"},
			expected: []string{"workspace-2"},
		},
		"skips a window reopened minimized": {
			targets:  []namedWorkspaceTarget{{geometry: panelwindow.NamedWorkspaceGeometry{Minimized: true}}, {}},
			expected: []string{"workspace-2"},
		},
		"prefers the window that entered fullscreen last": {
			targets: []namedWorkspaceTarget{
				{}, {geometry: panelwindow.NamedWorkspaceGeometry{Fullscreen: true}}, {geometry: panelwindow.NamedWorkspaceGeometry{Fullscreen: true}},
			},
			expected: []string{"workspace-3"},
		},
		"skips a window that has since closed": {
			targets: []namedWorkspaceTarget{{}, {}}, closed: []string{"workspace-1"},
			expected: []string{"workspace-2"},
		},
		"moves on when a window cannot take the event": {
			targets: []namedWorkspaceTarget{{}, {}}, unreachable: []string{"workspace-1"},
			expected: []string{"workspace-2"},
		},
		"falls back to a minimized window when it is the only one": {
			targets:  []namedWorkspaceTarget{{geometry: panelwindow.NamedWorkspaceGeometry{Minimized: true}}},
			expected: []string{"workspace-1"},
		},
		"is delivered nowhere when every window has closed": {
			targets: []namedWorkspaceTarget{{}}, closed: []string{"workspace-1"},
		},
	}
	for name, test := range cases {
		t.Run(name, func(t *testing.T) {
			r := NewRegistry(nil, &recordingLifecycleBackend{})
			restore := &namedWorkspaceRestore{answered: map[string]bool{}}
			for _, target := range test.targets {
				target.name = r.lifecycle.Add()
				readyAppWindow(r, target.name)
				restore.targets = append(restore.targets, target)
			}
			for _, answered := range test.answered {
				restore.answered[answered] = true
			}
			for _, closed := range test.closed {
				r.lifecycle.BeginClose(closed)
			}
			var delivered []string
			r.emitWindowEvent = func(window, _ string, data any) bool {
				if slices.Contains(test.unreachable, window) {
					return false
				}
				require.Equal(t, window, data.(panelwindow.NamedWorkspaceWarningsEvent).WindowName)
				delivered = append(delivered, window)
				return true
			}
			require.NoError(t, r.reportOpenedWorkspace(restore, missing, nil))
			require.Equal(t, test.expected, delivered)
		})
	}
}

// fullscreenProbeWindow answers only what entering fullscreen asks of a window.
type fullscreenProbeWindow struct {
	application.Window
	announces  bool
	fullscreen bool
	awaited    events.WindowEventType
	listener   func(*application.WindowEvent)
}

func (w *fullscreenProbeWindow) OnWindowEvent(event events.WindowEventType, callback func(*application.WindowEvent)) func() {
	w.awaited, w.listener = event, callback
	return func() {}
}

func (w *fullscreenProbeWindow) Fullscreen() application.Window {
	if w.announces && w.listener != nil {
		w.listener(nil)
	}
	return w
}

func (w *fullscreenProbeWindow) IsFullscreen() bool { return w.fullscreen }

// A fullscreen request can be dropped. The restore reports the window that did
// not get there instead of counting a request as a result.
func TestEnterFullscreenReportsWhetherTheWindowGotThere(t *testing.T) {
	cases := map[string]struct {
		goos     string
		window   fullscreenProbeWindow
		awaited  events.WindowEventType
		expected bool
	}{
		"macOS announces the transition ended":        {goos: "darwin", window: fullscreenProbeWindow{announces: true}, awaited: events.Mac.WindowDidEnterFullScreen, expected: true},
		"macOS dropped the request":                   {goos: "darwin", window: fullscreenProbeWindow{}, awaited: events.Mac.WindowDidEnterFullScreen},
		"macOS announcement missed, window got there": {goos: "darwin", window: fullscreenProbeWindow{fullscreen: true}, awaited: events.Mac.WindowDidEnterFullScreen, expected: true},
		"Linux window manager refused":                {goos: "linux", window: fullscreenProbeWindow{}, awaited: events.Common.WindowFullscreen},
		"Linux announces the state change":            {goos: "linux", window: fullscreenProbeWindow{announces: true}, awaited: events.Common.WindowFullscreen, expected: true},
		"Windows enters at once":                      {goos: "windows", window: fullscreenProbeWindow{fullscreen: true}, expected: true},
		"Windows did not enter":                       {goos: "windows", window: fullscreenProbeWindow{}},
	}
	for name, test := range cases {
		t.Run(name, func(t *testing.T) {
			window := test.window
			require.Equal(t, test.expected, enterFullscreenOn(test.goos, &window, 20*time.Millisecond))
			require.Equal(t, test.awaited, window.awaited)
		})
	}
}

// A window that does not reach fullscreen leaves the switch committed but
// incomplete. The switch reports it, with the saved clusters it could not open,
// in one warning to a window of the new workspace.
func TestNamedWorkspaceReportsAWindowThatDidNotEnterFullscreen(t *testing.T) {
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	r, source := switchRegistry(t, &recordingLifecycleBackend{
		windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{"available"},
	}, &warnings)
	r.restoreWindowState = func(_ string, state panelwindow.NamedWorkspaceGeometry) bool { return !state.Fullscreen }
	bounds := panelwindow.WindowBounds{Width: 1100, Height: 800}
	err := r.OpenNamedWorkspace(context.Background(), source, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{
			{Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: bounds, Fullscreen: true}},
			{Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: bounds, Maximized: true}},
		},
		PanelWindows: []panelwindow.NamedWorkspacePanelWindow{{Group: panelwindow.WorkspaceGroup{ClusterID: "missing"}}},
	})
	require.NoError(t, err, "the workspace opened; what is missing is a warning")
	require.Equal(t, []string{"workspace-2", "workspace-3"}, r.lifecycle.Names(), "the switch is committed")
	require.Equal(t, []panelwindow.NamedWorkspaceWarningsEvent{{
		WindowName: "workspace-2", MissingClusters: []string{"missing"}, NotFullscreen: 1,
	}}, warnings)
}

// requireSwitchRefused checks the current window is still the whole
// arrangement and nothing of the switch is left behind.
func requireSwitchRefused(t *testing.T, r *Registry, source string) {
	t.Helper()
	require.Equal(t, []string{source}, r.lifecycle.Names(), "the current window is still the live arrangement")
	require.Empty(t, r.panels.Names(""))
	require.Nil(t, r.pendingQuit)
	require.Nil(t, r.activeRestore.Load())
}

// Opening a workspace closes the current windows and then loads the saved
// ones. The saved windows are created hidden first, because Windows and Linux
// end the process the moment no window is left, and they are shown only once
// the previous windows are gone. What the previous windows held in the backend
// is given up last, so a cluster both workspaces show stays connected.
func TestSwitchClosesThePreviousWindowsThenShowsTheSavedOnes(t *testing.T) {
	panel := validPanelGroupSnapshot()
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{panel.ClusterID}}
	r, source := switchRegistry(t, backend, &warnings)
	_, _, err := r.workspace.Open(panel.Tabs[0], panelwindow.PanelLocation{
		WindowName: source, GroupID: "right", Kind: panelwindow.PanelLocationDocked, Active: true,
	})
	require.NoError(t, err)
	var steps []string
	create := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		require.True(t, options.Hidden)
		require.True(t, r.lifecycle.Contains(source), "a window exists at every moment of the switch")
		require.Empty(t, r.workspace.Snapshot(panel.ClusterID).Panels, "the previous workspace's panels are gone before a saved window loads")
		steps = append(steps, "create "+options.Name)
		return create(options)
	}
	closeWindow := r.closeWindow
	r.closeWindow = func(window string) bool {
		require.NotNil(t, r.pendingQuit, "quit is refused while the previous windows close")
		steps = append(steps, "close "+window)
		return closeWindow(window)
	}
	r.showWindow = func(window string) bool {
		require.NotNil(t, r.pendingQuit, "quit is refused until a saved window is on screen")
		require.NotContains(t, backend.released, source, "the previous windows' clusters are held until the saved windows are up")
		steps = append(steps, "show "+window)
		return true
	}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, oneAppWindowWorkspace(panel.ClusterID)))
	require.Equal(t, []string{"create workspace-2", "close " + source, "show workspace-2"}, steps)
	require.Equal(t, []string{"workspace-2"}, r.lifecycle.Names())
	require.Contains(t, backend.released, source)
	require.Len(t, backend.released, 2, "the previous window's clusters and the switch's own claim are both given up")
	require.Contains(t, backend.releasedPanelReferences, "panel-workspace:"+panel.ClusterID, "the previous workspace's panels no longer keep their cluster alive")
	require.Equal(t, []string{"workspace-2"}, r.readyWorkspaceNames(), "a closed window is not left for a later save or switch to wait on")
	require.Empty(t, backend.preparedWindow, "closing the last previous window is not a quit")
	require.Equal(t, 1, backend.restartSelectionsPersisted, "the next launch opens the saved workspace")
	require.Empty(t, warnings)
}

// Until the panel directory is handed over, a switch that cannot go on leaves
// the current workspace exactly as it was: no window closed, none created, and
// nothing written for the next launch.
func TestSwitchRefusedBeforeTheHandOverChangesNothing(t *testing.T) {
	cases := map[string]func(r *Registry, cancel context.CancelFunc){
		// A removed cluster changes what the saved workspace may show.
		"the panel directory changed after the windows approved": func(r *Registry, _ context.CancelFunc) {
			r.workspace.RemoveCluster("some-cluster")
		},
		"the request was cancelled": func(_ *Registry, cancel context.CancelFunc) { cancel() },
	}
	for name, interfere := range cases {
		t.Run(name, func(t *testing.T) {
			var warnings []panelwindow.NamedWorkspaceWarningsEvent
			backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{"cluster-a"}}
			r, source := switchRegistry(t, backend, &warnings)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			// The saved clusters are claimed just before the hand-over.
			backend.onSeed = func(string) { interfere(r, cancel) }
			r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
				t.Errorf("window %q was created although the switch was refused", options.Name)
				return nil
			}
			r.closeWindow = func(window string) bool {
				t.Errorf("window %q was closed although the switch was refused", window)
				return true
			}
			require.Error(t, r.OpenNamedWorkspace(ctx, source, oneAppWindowWorkspace("cluster-a")))
			requireSwitchRefused(t, r, source)
			require.Len(t, backend.released, 1, "the claim on the saved clusters is given up")
			require.Zero(t, backend.restartSelectionsPersisted)
		})
	}
}

// Once the previous windows are closed nothing is rolled back. A saved window
// that fails to load, or never answers, is shown as it is and counted; one that
// cannot be created at all is counted and the others still open.
func TestSavedWindowsThatDoNotLoadAreShownAndReported(t *testing.T) {
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{validPanelGroupSnapshot().ClusterID}}
	r, source := switchRegistry(t, backend, &warnings)
	answer := r.emitWindowEvent
	r.emitWindowEvent = func(window, event string, data any) bool {
		if event != panelwindow.NamedWorkspaceRestoreRequested {
			return answer(window, event, data)
		}
		switch window {
		case "workspace-2":
			return answer(window, event, data)
		case "workspace-3":
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, "saved view could not be mounted"))
		}
		// workspace-4 never answers.
		return true
	}
	create := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		if options.Name == "workspace-5" {
			return nil
		}
		return create(options)
	}
	var shown []string
	r.showWindow = func(window string) bool { shown = append(shown, window); return true }
	workspace := oneAppWindowWorkspace()
	for range 3 {
		workspace.AppWindows = append(workspace.AppWindows, workspace.AppWindows[0])
	}
	// The window that cannot be created had a docked panel in a cluster no
	// other window shows.
	lost := validPanelGroupSnapshot()
	workspace.AppWindows[3].ClusterTabs = []panelwindow.NamedWorkspaceClusterTab{{ClusterID: lost.ClusterID}}
	workspace.AppWindows[3].SelectedClusterID = lost.ClusterID
	workspace.AppWindows[3].DockedGroups = []panelwindow.NamedWorkspaceDockedGroup{{Width: 600, Height: 400, Group: panelwindow.WorkspaceGroup{
		ClusterID: lost.ClusterID, GroupID: "right", Tabs: lost.Tabs, ActivePanelID: lost.ActivePanelID,
	}}}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, workspace))
	require.Empty(t, r.workspace.Snapshot(lost.ClusterID).Panels, "its panels are not left in the directory")
	require.Contains(t, backend.releasedPanelReferences, "panel-workspace:"+lost.ClusterID, "nor is its cluster kept alive for them")
	require.Equal(t, []string{"workspace-2", "workspace-3", "workspace-4"}, shown)
	require.Equal(t, []string{"workspace-2", "workspace-3", "workspace-4"}, r.lifecycle.Names())
	require.Equal(t, []panelwindow.NamedWorkspaceWarningsEvent{{
		WindowName: "workspace-2", MissingClusters: []string{}, UnrestoredWindows: 3,
	}}, warnings)
}

// File > New Window gives the new window every selected cluster. During a
// switch that selection is being replaced, so the window is not created.
func TestNewWindowIsRefusedDuringASwitch(t *testing.T) {
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	r, source := switchRegistry(t, &recordingLifecycleBackend{windowClusters: map[string][]string{}}, &warnings)
	create := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		window := create(options)
		require.Nil(t, r.Create(false))
		return window
	}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, oneAppWindowWorkspace()))
	require.Equal(t, []string{"workspace-2"}, r.lifecycle.Names())
	r.newWindow = create
	require.NotNil(t, r.Create(false), "once the switch is over, new windows open again")
}

// The saved windows are ordinary windows from the moment the previous ones
// close, so the user can close them all before the switch has finished. The
// app then quits as it does for any last window, instead of running on with
// nothing on screen.
func TestClosingEverySavedWindowDuringTheSwitchQuitsTheApp(t *testing.T) {
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	r, source := switchRegistry(t, &recordingLifecycleBackend{windowClusters: map[string][]string{}, allowQuit: true}, &warnings)
	quits := 0
	r.requestApplicationQuit = func() {
		require.Nil(t, r.pendingQuit, "the switch must not be holding quit back any more")
		quits++
	}
	closeWindow := r.closeWindow
	r.closeWindow = func(window string) bool {
		if window == source {
			// The previous window is on its way out; the user closes the new one.
			require.NoError(t, r.AcknowledgeWorkspaceWindowClose("workspace-2"))
		}
		return closeWindow(window)
	}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, oneAppWindowWorkspace()))
	require.Empty(t, r.lifecycle.Names())
	require.Equal(t, 1, quits)
}

// A window that closes while a save is waiting for it can never answer. The
// save ends then, instead of holding the dialog until the capture deadline.
func TestCaptureEndsWhenAWindowClosesBeforeAnswering(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	first, second := registry.lifecycle.Add(), registry.lifecycle.Add()
	readyAppWindow(registry, first)
	readyAppWindow(registry, second)
	registry.windowGeometry = func(string) (geometry, bool) { return geometry{Width: 1300, Height: 700}, true }
	registry.closeWindow = func(window string) bool { registry.handleClosing(nil, window); return true }
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		request, capture := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		if !capture {
			return true
		}
		if name == second {
			// Closed by its own renderer, as a window the user just closed is.
			go func() { _ = registry.AcknowledgeWorkspaceWindowClose(second) }()
			return true
		}
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, panelwindow.NamedWorkspaceAppView{}, ""))
		return true
	}
	started := time.Now()
	_, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.ErrorContains(t, err, second)
	require.Less(t, time.Since(started), 5*time.Second, "the save must not wait out its capture deadline")
}

// A cluster view that is moving between windows belongs to neither yet. A save
// taken then would record it in a window that is about to lose it, and a
// switch would close windows in the middle of the move.
func TestSaveAndSwitchWaitForAClusterViewMoveToFinish(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	readyAppWindow(registry, source)
	readyAppWindow(registry, target)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "cluster-move", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	registry.emitWindowEvent = func(window, event string, _ any) bool {
		t.Errorf("window %q was sent %q during a cluster view move", window, event)
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), source)
	require.Error(t, err)
	require.Error(t, registry.OpenNamedWorkspace(context.Background(), source, oneAppWindowWorkspace()))
	require.Nil(t, registry.pendingQuit)
}

// A saved window's docked panels are placed for it before it loads, and it
// arranges them through the same publication as any other window.
func TestRestoredWindowOwnsItsDockedPanelsLikeAnyOtherWindow(t *testing.T) {
	panel := validPanelGroupSnapshot()
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	r, source := switchRegistry(t, &recordingLifecycleBackend{
		windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{panel.ClusterID},
	}, &warnings)
	docked := panelwindow.WorkspaceGroup{ClusterID: panel.ClusterID, GroupID: "right", Tabs: panel.Tabs, ActivePanelID: panel.ActivePanelID}
	workspace := oneAppWindowWorkspace(panel.ClusterID)
	workspace.AppWindows[0].DockedGroups = []panelwindow.NamedWorkspaceDockedGroup{{Group: docked, Width: 600, Height: 400}}
	create := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		window := create(options)
		snapshot, err := r.GetPanelWorkspace(options.Name, panel.ClusterID)
		require.NoError(t, err)
		require.Len(t, snapshot.Panels, len(panel.Tabs), "the saved panels are already this window's when it loads")
		require.NoError(t, r.PublishDockedPanels(options.Name, []panelwindow.WorkspaceGroup{docked}))
		return window
	}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, workspace))
	groups := r.workspace.DockedGroups(panel.ClusterID, "workspace-2")
	require.Len(t, groups, 1)
	require.Equal(t, panel.Tabs, groups[0].Tabs)
	require.Empty(t, warnings)
}

// A saved panel window that has not loaded by the deadline has no working
// close button and would keep every later save and switch waiting for it. It
// is closed and its panels are given up.
func TestRestoredPanelWindowThatNeverLoadsIsClosed(t *testing.T) {
	panel := validPanelGroupSnapshot()
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{panel.ClusterID}}
	r, source := switchRegistry(t, backend, &warnings)
	create := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		if _, err := r.PanelDescriptor(options.Name); err == nil {
			// Its renderer never comes up.
			return application.New(application.Options{}).Window.NewWithOptions(options)
		}
		return create(options)
	}
	var shown []string
	r.showWindow = func(window string) bool { shown = append(shown, window); return true }
	workspace := oneAppWindowWorkspace()
	workspace.PanelWindows = []panelwindow.NamedWorkspacePanelWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 700, Height: 440}},
		Group:    panelwindow.WorkspaceGroup{ClusterID: panel.ClusterID, GroupID: panel.GroupID, Tabs: panel.Tabs, ActivePanelID: panel.ActivePanelID},
	}}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, workspace))
	require.Equal(t, []string{"workspace-2"}, shown)
	require.Empty(t, r.panels.Names(""))
	require.Empty(t, r.workspace.Snapshot(panel.ClusterID).Panels)
	require.Contains(t, backend.releasedPanelReferences, "panel-1")
	require.Contains(t, backend.releasedPanelReferences, "panel-workspace:"+panel.ClusterID)
	require.Equal(t, []string{"workspace-2"}, r.readyWorkspaceNames(), "nothing is left for a later save or switch to wait on")
	require.Equal(t, []panelwindow.NamedWorkspaceWarningsEvent{{
		WindowName: "workspace-2", MissingClusters: []string{}, UnrestoredWindows: 1,
	}}, warnings)
}

// A cluster view that starts moving after the save was admitted is in both
// windows for a moment. The save must not record it twice.
func TestCaptureRefusesAClusterViewMoveThatStartsWhileItWaits(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	readyAppWindow(registry, source)
	readyAppWindow(registry, target)
	registry.windowGeometry = func(string) (geometry, bool) { return geometry{Width: 1300, Height: 700}, true }
	view := panelwindow.NamedWorkspaceAppView{
		SelectedClusterID: "cluster-1", ClusterTabs: []panelwindow.NamedWorkspaceClusterTab{{ClusterID: "cluster-1"}},
	}
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		request, capture := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		if !capture {
			return true
		}
		if name == target {
			move := panelwindow.ClusterTabTransferRequest{TransferID: "cluster-move", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
			require.NoError(t, registry.RequestClusterTabTransfer(target, move))
		}
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, view, ""))
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), source)
	require.Error(t, err)
}

// A window normally shows itself when its runtime is ready. A saved window is
// shown by the switch instead, once it has loaded and been placed.
func TestRestoredWindowIsShownByTheSwitchNotByItsRuntime(t *testing.T) {
	var warnings []panelwindow.NamedWorkspaceWarningsEvent
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	r, source := switchRegistry(t, backend, &warnings)
	created := map[string]*application.WebviewWindow{}
	create := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		created[options.Name] = create(options)
		return created[options.Name]
	}
	// The runtime-ready listener reads the window's geometry last.
	ran := make(chan string, 8)
	r.windowGeometry = func(name string) (geometry, bool) {
		ran <- name
		return geometry{}, false
	}
	r.showWindow = func(window string) bool {
		created[window].HandleWindowEvent(uint(events.Common.WindowRuntimeReady))
		select {
		case <-ran:
		case <-time.After(time.Second):
			t.Fatal("the runtime-ready listener did not run")
		}
		return true
	}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, oneAppWindowWorkspace()))
	require.NotContains(t, backend.readyWindows, "workspace-2")
}
