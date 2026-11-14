package backend

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type namedWorkspaceTestWindows struct {
	state      NamedWorkspace
	captureErr error
	openErr    error
	reply      panelwindow.NamedWorkspaceAppView
	failure    string
	opened     NamedWorkspace
	restored   string
}

func (w *namedWorkspaceTestWindows) CaptureNamedWorkspace(context.Context, string) (NamedWorkspace, error) {
	return w.state, w.captureErr
}

func (w *namedWorkspaceTestWindows) SubmitNamedWorkspaceCapture(_, _ string, view panelwindow.NamedWorkspaceAppView, failure string) error {
	w.reply, w.failure = view, failure
	return nil
}

// namedWorkspaceRevision is the revision a dialog holds after listing the name.
func namedWorkspaceRevision(t *testing.T, lister interface {
	ListNamedWorkspaces() ([]NamedWorkspaceEntry, error)
}, name string) string {
	t.Helper()
	entries, err := lister.ListNamedWorkspaces()
	require.NoError(t, err)
	for _, entry := range entries {
		if entry.Name == name {
			return entry.Revision
		}
	}
	require.Failf(t, "workspace is not listed", "%q", name)
	return ""
}

// savedNamedWorkspace reads the snapshot currently listed under the name.
func savedNamedWorkspace(t *testing.T, store *UIStateStore, name string) *NamedWorkspace {
	t.Helper()
	saved, err := store.GetNamedWorkspace(name, namedWorkspaceRevision(t, store, name))
	require.NoError(t, err)
	return saved
}

func namedWorkspaceNames(t *testing.T, lister interface {
	ListNamedWorkspaces() ([]NamedWorkspaceEntry, error)
}) []string {
	t.Helper()
	entries, err := lister.ListNamedWorkspaces()
	require.NoError(t, err)
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name)
	}
	return names
}

func TestDesktopNamedWorkspaceSaveKeepsPreviousSnapshotOnCaptureFailure(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	windows := &namedWorkspaceTestWindows{state: NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
	}}}}
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(windows, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))
	require.Error(t, service.SaveNamedWorkspace(ctx, "another-window", "Triage", false, ""))
	require.Error(t, service.SaveNamedWorkspace(ctx, "workspace-1", " ", false, ""))
	require.NoError(t, service.SaveNamedWorkspace(ctx, "workspace-1", "Triage", false, ""))
	require.Equal(t, []string{"Triage"}, namedWorkspaceNames(t, service))
	revision := namedWorkspaceRevision(t, service, "Triage")

	windows.captureErr = errors.New("window disappeared")
	require.ErrorIs(t, service.SaveNamedWorkspace(ctx, "workspace-1", "Triage", true, revision), windows.captureErr)
	saved, err := store.GetNamedWorkspace("Triage", revision)
	require.NoError(t, err)
	require.Equal(t, windows.state.AppWindows, saved.AppWindows)

	view := panelwindow.NamedWorkspaceAppView{SelectedClusterID: "config:prod"}
	require.Error(t, service.SubmitNamedWorkspaceCapture(ctx, "another-window", "request", view, ""))
	require.NoError(t, service.SubmitNamedWorkspaceCapture(ctx, "workspace-1", "request", view, "tables unavailable"))
	require.Equal(t, "config:prod", windows.reply.SelectedClusterID)
	require.Equal(t, "tables unavailable", windows.failure)

	require.Error(t, service.OpenNamedWorkspace(ctx, "another-window", "Triage", revision))
	require.Error(t, service.OpenNamedWorkspace(ctx, "workspace-1", "Missing", ""))
	require.NoError(t, service.OpenNamedWorkspace(ctx, "workspace-1", "Triage", revision))
	require.Equal(t, *saved, windows.opened)
	require.Error(t, service.AcknowledgeNamedWorkspaceRestore(ctx, "another-window", ""))
	require.NoError(t, service.AcknowledgeNamedWorkspaceRestore(ctx, "workspace-1", ""))
	require.Equal(t, "workspace-1", windows.restored)
}

func TestNamedWorkspaceBindingReportsRoutineRefusalsAsExpected(t *testing.T) {
	setTestConfigEnv(t)
	const window = "workspace-1"
	windows := &namedWorkspaceTestWindows{state: NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
	}}}}
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(windows, NewUIStateStore())})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller(window))
	check := func(err error, reason errorstatus.Reason, expected bool) {
		t.Helper()
		require.Error(t, err)
		var status errorstatus.Status
		require.NoError(t, json.Unmarshal(MarshalBindingError(err), &status))
		require.Equal(t, reason, status.Reason)
		require.Equal(t, expected, status.Expected)
	}
	require.NoError(t, service.SaveNamedWorkspace(ctx, window, "Triage", false, ""))
	revision := namedWorkspaceRevision(t, service, "Triage")
	check(service.SaveNamedWorkspace(ctx, window, "Triage", false, ""), errorstatus.ReasonConflict, true)
	check(service.OpenNamedWorkspace(ctx, window, "Triage", "stale-revision"), errorstatus.ReasonConflict, true)
	check(service.DeleteNamedWorkspace(ctx, window, "Missing", ""), errorstatus.ReasonNotFound, true)
	windows.openErr = panelwindow.WorkspaceConflict("workspace switch cancelled by an open window")
	check(service.OpenNamedWorkspace(ctx, window, "Triage", revision), errorstatus.ReasonConflict, true)
	windows.captureErr = panelwindow.ErrWorkspaceSwitching
	check(service.SaveNamedWorkspace(ctx, window, "Triage", true, revision), errorstatus.ReasonConflict, true)
	windows.openErr = errors.New("native window creation failed")
	check(service.OpenNamedWorkspace(ctx, window, "Triage", revision), errorstatus.ReasonUnknown, false)
}

func TestNamedWorkspaceKeepsEachWindowsLayoutAcrossRestart(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	const clusterID = "/config/ops:prod"
	const stageID = "/config/ops:stage"
	workspace := NamedWorkspace{
		SchemaVersion: 1,
		AppWindows: []NamedWorkspaceAppWindow{
			{
				Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{X: -1300, Y: 20, Width: 1200, Height: 800}, Maximized: true},
				NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
					SelectedClusterID: clusterID,
					ClusterTabs: []NamedWorkspaceClusterTab{
						{ClusterID: stageID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:stage"}`)},
						{ClusterID: clusterID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:prod","namespace":"payments","tables":{"workloads":{"filters":{"search":"checkout"}}}}`)},
					},
				},
			},
			{
				Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{X: 80, Y: 60, Width: 900, Height: 700}, Fullscreen: true},
				NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
					SelectedClusterID: clusterID,
					ClusterTabs: []NamedWorkspaceClusterTab{
						{ClusterID: clusterID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:prod","namespace":"platform","tables":{"workloads":{"filters":{"search":"gateway"}}}}`)},
					},
				},
			},
		},
		PanelWindows: []NamedWorkspacePanelWindow{{
			Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{X: -900, Y: 360, Width: 700, Height: 440}, Minimized: true},
			Group: panelwindow.WorkspaceGroup{
				ClusterID: clusterID, GroupID: "logs", ActivePanelID: "pod-logs",
				Tabs: []panelwindow.TabSnapshot{{
					Kind: panelwindow.TabKindObject, PanelID: "pod-logs", ActiveView: "logs",
					ObjectRef: panelwindow.ObjectReference{ClusterID: clusterID, Version: "v1", Kind: "Pod", Namespace: "payments", Name: "checkout-1"},
				}},
			},
		}},
	}
	// The workspace and the existing startup tab order share the UI state store.
	require.NoError(t, store.SetClusterTabOrder([]string{clusterID, stageID}))
	require.NoError(t, store.SaveNamedWorkspace("Production triage", workspace, false, ""))
	require.NoError(t, store.SetClusterTabOrder([]string{stageID, clusterID}))

	restarted := NewUIStateStore()
	saved := savedNamedWorkspace(t, restarted, "Production triage")
	// The store stamps the snapshot; everything the capture reported is kept.
	workspace.Revision = saved.Revision
	require.Equal(t, &workspace, saved)
	order, err := restarted.GetClusterTabOrder()
	require.NoError(t, err)
	require.Equal(t, []string{stageID, clusterID}, order)
}

func TestNamedWorkspaceKeepsGlobalAndDockedViews(t *testing.T) {
	setTestConfigEnv(t)
	const clusterID = "/config/ops:prod"
	const stageID = "/config/ops:stage"
	window := NamedWorkspaceAppWindow{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
		NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
			SelectedClusterID: clusterID,
			ClusterTabs: []NamedWorkspaceClusterTab{
				{ClusterID: clusterID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:prod"}`)},
				{ClusterID: stageID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:stage"}`)},
			},
			GlobalView: &NamedWorkspaceGlobalView{
				View:   "global-namespaces",
				Tables: map[string]json.RawMessage{"global-namespaces": json.RawMessage(`{"sort":{"key":"name","direction":"asc"}}`)},
			},
			DockedGroups: []NamedWorkspaceDockedGroup{{
				Width: 460, Height: 800,
				Group: panelwindow.WorkspaceGroup{
					ClusterID: clusterID, GroupID: "right", ActivePanelID: "deployment",
					Tabs: []panelwindow.TabSnapshot{{
						Kind: panelwindow.TabKindObject, PanelID: "deployment", ActiveView: "yaml",
						ObjectRef: panelwindow.ObjectReference{ClusterID: clusterID, Group: "apps", Version: "v1", Kind: "Deployment", Namespace: "payments", Name: "checkout"},
					}},
				},
			}},
		},
	}
	workspace := NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{window}}
	require.NoError(t, NewUIStateStore().SaveNamedWorkspace("Fleet", workspace, false, ""))
	saved := savedNamedWorkspace(t, NewUIStateStore(), "Fleet")
	require.Equal(t, window, saved.AppWindows[0])

	// A capture caught between docking and floating can report both placements.
	workspace.PanelWindows = []NamedWorkspacePanelWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 700, Height: 440}},
		Group:    window.DockedGroups[0].Group,
	}}
	require.Error(t, NewUIStateStore().SaveNamedWorkspace("Fleet", workspace, true, saved.Revision))
	require.Equal(t, saved, savedNamedWorkspace(t, NewUIStateStore(), "Fleet"))
}

func TestNamedWorkspaceRejectsIncompleteOrMismatchedCapture(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	const name = "Production triage"
	const clusterID = "/config/ops:prod"
	for _, test := range []struct {
		name   string
		change func(*NamedWorkspace)
	}{
		{"no registered windows", func(workspace *NamedWorkspace) { workspace.AppWindows = nil }},
		{"renderer has no window bounds", func(workspace *NamedWorkspace) {
			workspace.AppWindows[0].Geometry = panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{}}
		}},
		{"renderer has no visible cluster", func(workspace *NamedWorkspace) { workspace.AppWindows[0].SelectedClusterID = "" }},
		{"view belongs to another cluster", func(workspace *NamedWorkspace) {
			workspace.AppWindows[0].ClusterTabs[0].ViewState = json.RawMessage(`{"clusterId":"/config/ops:stage"}`)
		}},
		{"unrecognized schema version", func(workspace *NamedWorkspace) { workspace.SchemaVersion++ }},
	} {
		t.Run(test.name, func(t *testing.T) {
			workspace := NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
				Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
				NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
					SelectedClusterID: clusterID,
					ClusterTabs: []NamedWorkspaceClusterTab{{
						ClusterID: clusterID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:prod"}`),
					}},
				},
			}}}
			// An invalid first capture must never publish a workspace that can be opened.
			test.change(&workspace)
			require.Error(t, store.SaveNamedWorkspace(name, workspace, false, ""))
			saved, err := store.ListNamedWorkspaces()
			require.NoError(t, err)
			require.Empty(t, saved)
		})
	}
}

func TestNamedWorkspaceRequiresExplicitReplacement(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	const name = "Production triage"
	workspace := NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
	}}}
	require.NoError(t, store.SaveNamedWorkspace(name, workspace, false, ""))
	workspace.AppWindows[0].Geometry.Width = 900
	require.Error(t, store.SaveNamedWorkspace(name, workspace, false, ""))
	saved := savedNamedWorkspace(t, store, name)
	require.Equal(t, 1200, saved.AppWindows[0].Geometry.Width)
	require.NoError(t, store.SaveNamedWorkspace(name, workspace, true, saved.Revision))
	require.Equal(t, 900, savedNamedWorkspace(t, store, name).AppWindows[0].Geometry.Width)
	// Replacing is for a workspace the caller listed, never a way to create one.
	require.Error(t, store.SaveNamedWorkspace("Unlisted", workspace, true, ""))
	require.Equal(t, []string{name}, namedWorkspaceNames(t, store))
}

func (w *namedWorkspaceTestWindows) OpenNamedWorkspace(_ context.Context, _ string, snapshot NamedWorkspace) error {
	w.opened = snapshot
	return w.openErr
}
func (w *namedWorkspaceTestWindows) AcknowledgeNamedWorkspaceRestore(window, _ string) error {
	w.restored = window
	return nil
}

func TestNamedWorkspaceSeedsOnlyTheDiscoveredSelectionsForItsWindow(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "prod"},
		{Name: "config", Path: "/tmp/config", Context: "stage"},
		{Name: "config", Path: "/tmp/config", Context: "invalid", Invalid: true},
	}
	selections := []string{"/tmp/config:prod", "/tmp/config:stage"}
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked(selections)
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("current")
	available, err := app.Lifecycle.NamedWorkspaceAvailableClusters()
	require.NoError(t, err)
	require.Equal(t, []string{"config:prod", "config:stage"}, available)
	require.Error(t, app.Lifecycle.SeedNamedWorkspaceWindow("new", []string{"config:invalid"}, "config:invalid"))
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("new", []string{"config:stage"}, "config:stage"))
	require.Equal(t, []string{"config:stage"}, app.Workspace.WindowClusterIDs("new"))
	require.Equal(t, []string{"config:prod", "config:stage"}, app.Workspace.WindowClusterIDs("current"))
	require.Equal(t, selections, app.Workspace.GetSelectedKubeconfigs())
}

// The membership snapshot can precede its process-selection commit. A restored
// window must not claim a cluster whose last owner is already gone, or it would
// show a tab for a runtime that the pending commit then removes.
func TestNamedWorkspaceSeedCannotOvertakeLastOwnerRemoval(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	w := app.Workspace
	selection, clusterID := "/tmp/config:closing", "config:closing"
	w.selectedKubeconfigs = []string{selection}
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Name: "config", Path: "/tmp/config", Context: "closing"}}
	w.GetClusterWorkspaceStateForWindow("workspace-1")
	removed, resume := make(chan struct{}), make(chan struct{})
	closing := make(chan error, 1)
	go func() {
		closing <- w.runOrderedSelectionMutation("close-cluster-view", func(mutation *selectionMutation) error {
			intent, err := w.removeClusterView(mutation, "workspace-1", clusterID)
			if err != nil {
				return err
			}
			close(removed)
			<-resume
			if intent != nil {
				w.commitKubeconfigSelection(mutation, intent)
			}
			return nil
		})
	}()
	released := false
	defer func() {
		if !released {
			close(resume)
		}
		w.cancelActiveSelectionGeneration()
		require.True(t, w.waitForSelectionMutationIdle(time.Second))
	}()
	select {
	case <-removed:
	case <-time.After(time.Second):
		t.Fatal("close did not remove the last owner")
	}
	require.Equal(t, []string{selection}, w.GetSelectedKubeconfigs(), "the runtime selection has not committed yet")
	seeded := make(chan error, 1)
	go func() { seeded <- w.SeedNamedWorkspaceWindow("restored", []string{selection}, clusterID) }()
	require.Eventually(t, func() bool {
		diagnostics, err := w.GetSelectionDiagnostics()
		return err == nil && diagnostics.ActiveQueueDepth == 2
	}, time.Second, time.Millisecond, "seeding a closing cluster must wait for ordered retirement")
	require.Empty(t, w.WindowClusterIDs("restored"))
	close(resume)
	released = true
	require.NoError(t, <-closing)
	require.NoError(t, <-seeded)
	require.Equal(t, []string{selection}, w.GetSelectedKubeconfigs(), "the seed reopens the cluster it owns")
	require.Equal(t, []string{clusterID}, w.WindowClusterIDs("restored"))
}

// Renaming moves one saved layout to its new name and never overwrites another.
func TestNamedWorkspaceRenameMovesTheSnapshotWithoutOverwritingAnother(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	sized := func(width int) NamedWorkspace {
		return NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
			Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: width, Height: 800}},
		}}}
	}
	require.NoError(t, store.SaveNamedWorkspace("Triage", sized(1200), false, ""))
	require.NoError(t, store.SaveNamedWorkspace("Release", sized(900), false, ""))
	revision := namedWorkspaceRevision(t, store, "Triage")
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(&namedWorkspaceTestWindows{}, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))

	require.Error(t, service.RenameNamedWorkspace(ctx, "another-window", "Triage", "Incident", revision))
	require.Error(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Missing", "Incident", ""))
	require.Error(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", "Release", revision))
	require.Error(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", "  ", revision))
	require.NoError(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", "Triage", revision))
	require.NoError(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", " Incident ", revision))

	restarted := NewUIStateStore()
	require.Equal(t, []string{"Incident", "Release"}, namedWorkspaceNames(t, restarted))
	require.Equal(t, 1200, savedNamedWorkspace(t, restarted, "Incident").AppWindows[0].Geometry.Width)
	require.Equal(t, 900, savedNamedWorkspace(t, restarted, "Release").AppWindows[0].Geometry.Width)
}

// Deleting removes one saved workspace from disk and leaves the others openable.
func TestNamedWorkspaceDeleteRemovesOnlyTheNamedSnapshot(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	workspace := NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
	}}}
	require.NoError(t, store.SaveNamedWorkspace("Triage", workspace, false, ""))
	require.NoError(t, store.SaveNamedWorkspace("Release", workspace, false, ""))
	revision := namedWorkspaceRevision(t, store, "Triage")
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(&namedWorkspaceTestWindows{}, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))

	require.Error(t, service.DeleteNamedWorkspace(ctx, "another-window", "Triage", revision))
	require.Error(t, service.DeleteNamedWorkspace(ctx, "workspace-1", "Missing", ""))
	require.NoError(t, service.DeleteNamedWorkspace(ctx, "workspace-1", "Triage", revision))

	require.Equal(t, []string{"Release"}, namedWorkspaceNames(t, NewUIStateStore()))
	_, err := store.GetNamedWorkspace("Triage", revision)
	require.Error(t, err)
	savedNamedWorkspace(t, store, "Release")
}

// A name that is deleted and saved again names a different snapshot. A window
// that listed the first one must not replace, rename, delete or open the second.
func TestNamedWorkspaceChangesApplyOnlyToTheListedSnapshot(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	sized := func(width int) NamedWorkspace {
		return NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
			Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: width, Height: 800}},
		}}}
	}
	windows := &namedWorkspaceTestWindows{state: sized(1200)}
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(windows, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))
	const window = "workspace-1"

	require.NoError(t, service.SaveNamedWorkspace(ctx, window, "Triage", false, ""))
	stale := namedWorkspaceRevision(t, service, "Triage")
	require.NoError(t, service.DeleteNamedWorkspace(ctx, window, "Triage", stale))
	windows.state = sized(900)
	require.NoError(t, service.SaveNamedWorkspace(ctx, window, "Triage", false, ""))
	current := namedWorkspaceRevision(t, service, "Triage")

	// The other window still holds what it listed before the name was reused.
	windows.state = sized(700)
	require.Error(t, service.SaveNamedWorkspace(ctx, window, "Triage", true, stale))
	require.Error(t, service.RenameNamedWorkspace(ctx, window, "Triage", "Incident", stale))
	require.Error(t, service.DeleteNamedWorkspace(ctx, window, "Triage", stale))
	require.Error(t, service.OpenNamedWorkspace(ctx, window, "Triage", stale))
	require.Empty(t, windows.opened.AppWindows, "a refused open must not reach the windows")
	entries, err := service.ListNamedWorkspaces()
	require.NoError(t, err)
	require.Equal(t, []NamedWorkspaceEntry{{Name: "Triage", Revision: current}}, entries)
	require.NoError(t, service.OpenNamedWorkspace(ctx, window, "Triage", current))
	require.Equal(t, 900, windows.opened.AppWindows[0].Geometry.Width)

	// A replacement is a new snapshot too, so what was listed before it is stale.
	require.NoError(t, service.SaveNamedWorkspace(ctx, window, "Triage", true, current))
	replaced := namedWorkspaceRevision(t, service, "Triage")
	require.Error(t, service.OpenNamedWorkspace(ctx, window, "Triage", current))
	// A rename moves the same snapshot, so its listed revision still applies.
	require.NoError(t, service.RenameNamedWorkspace(ctx, window, "Triage", "Incident", replaced))
	require.NoError(t, service.OpenNamedWorkspace(ctx, window, "Incident", replaced))
	require.Equal(t, 700, windows.opened.AppWindows[0].Geometry.Width)
	require.NoError(t, service.DeleteNamedWorkspace(ctx, window, "Incident", replaced))
	require.Empty(t, namedWorkspaceNames(t, NewUIStateStore()))
}

// Workspaces saved before revisions existed have none. Listing gives each its
// own, so two of them can no longer be mistaken for each other when one is
// deleted and the other takes its name.
func TestNamedWorkspaceSavedBeforeRevisionsIsStampedWhenListed(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	sized := func(width int) NamedWorkspace {
		return NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
			Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: width, Height: 800}},
		}}}
	}
	state, err := store.loadPersistenceFile()
	require.NoError(t, err)
	state.Workspaces = map[string]NamedWorkspace{"Legacy": sized(1200), "Other": sized(900)}
	require.NoError(t, store.savePersistenceFile(state))

	entries, err := store.ListNamedWorkspaces()
	require.NoError(t, err)
	require.Len(t, entries, 2)
	legacy, other := entries[0].Revision, entries[1].Revision
	require.NotEmpty(t, legacy)
	require.NotEqual(t, legacy, other)
	again, err := NewUIStateStore().ListNamedWorkspaces()
	require.NoError(t, err)
	require.Equal(t, entries, again, "the revisions are saved, not made up on each listing")

	require.NoError(t, store.DeleteNamedWorkspace("Legacy", legacy))
	require.NoError(t, store.RenameNamedWorkspace("Other", "Legacy", other))
	// A dialog that listed the first "Legacy" must not reach the snapshot that
	// now has its name.
	_, err = store.GetNamedWorkspace("Legacy", legacy)
	require.Error(t, err)
	require.Error(t, store.DeleteNamedWorkspace("Legacy", legacy))
	saved, err := store.GetNamedWorkspace("Legacy", other)
	require.NoError(t, err)
	require.Equal(t, 900, saved.AppWindows[0].Geometry.Width)
}
