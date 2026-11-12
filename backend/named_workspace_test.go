package backend

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type namedWorkspaceTestWindows struct {
	state      NamedWorkspace
	captureErr error
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

func TestDesktopNamedWorkspaceSaveKeepsPreviousSnapshotOnCaptureFailure(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	windows := &namedWorkspaceTestWindows{state: NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
	}}}}
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(windows, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))
	require.Error(t, service.SaveNamedWorkspace(ctx, "another-window", "Triage", false))
	require.Error(t, service.SaveNamedWorkspace(ctx, "workspace-1", " ", false))
	require.NoError(t, service.SaveNamedWorkspace(ctx, "workspace-1", "Triage", false))
	names, err := service.ListNamedWorkspaces()
	require.NoError(t, err)
	require.Equal(t, []string{"Triage"}, names)

	windows.captureErr = errors.New("window disappeared")
	require.ErrorIs(t, service.SaveNamedWorkspace(ctx, "workspace-1", "Triage", true), windows.captureErr)
	saved, err := store.GetNamedWorkspace("Triage")
	require.NoError(t, err)
	require.Equal(t, &windows.state, saved)

	view := panelwindow.NamedWorkspaceAppView{SelectedClusterID: "config:prod"}
	require.Error(t, service.SubmitNamedWorkspaceCapture(ctx, "another-window", "request", view, ""))
	require.NoError(t, service.SubmitNamedWorkspaceCapture(ctx, "workspace-1", "request", view, "tables unavailable"))
	require.Equal(t, "config:prod", windows.reply.SelectedClusterID)
	require.Equal(t, "tables unavailable", windows.failure)

	require.Error(t, service.OpenNamedWorkspace(ctx, "another-window", "Triage"))
	require.Error(t, service.OpenNamedWorkspace(ctx, "workspace-1", "Missing"))
	require.NoError(t, service.OpenNamedWorkspace(ctx, "workspace-1", "Triage"))
	require.Equal(t, *saved, windows.opened)
	require.Error(t, service.AcknowledgeNamedWorkspaceRestore(ctx, "another-window", ""))
	require.NoError(t, service.AcknowledgeNamedWorkspaceRestore(ctx, "workspace-1", ""))
	require.Equal(t, "workspace-1", windows.restored)
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
				Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{X: 80, Y: 60, Width: 900, Height: 700}},
				NamedWorkspaceAppView: panelwindow.NamedWorkspaceAppView{
					SelectedClusterID: clusterID,
					ClusterTabs: []NamedWorkspaceClusterTab{
						{ClusterID: clusterID, ViewState: json.RawMessage(`{"clusterId":"/config/ops:prod","namespace":"platform","tables":{"workloads":{"filters":{"search":"gateway"}}}}`)},
					},
				},
			},
		},
		PanelWindows: []NamedWorkspacePanelWindow{{
			Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{X: -900, Y: 360, Width: 700, Height: 440}},
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
	require.NoError(t, store.SaveNamedWorkspace("Production triage", workspace, false))
	require.NoError(t, store.SetClusterTabOrder([]string{stageID, clusterID}))

	restarted := NewUIStateStore()
	saved, err := restarted.GetNamedWorkspace("Production triage")
	require.NoError(t, err)
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
	require.NoError(t, NewUIStateStore().SaveNamedWorkspace("Fleet", workspace, true))
	saved, err := NewUIStateStore().GetNamedWorkspace("Fleet")
	require.NoError(t, err)
	require.Equal(t, window, saved.AppWindows[0])

	// A capture caught between docking and floating can report both placements.
	workspace.PanelWindows = []NamedWorkspacePanelWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 700, Height: 440}},
		Group:    window.DockedGroups[0].Group,
	}}
	require.Error(t, NewUIStateStore().SaveNamedWorkspace("Fleet", workspace, true))
	reloaded, err := NewUIStateStore().GetNamedWorkspace("Fleet")
	require.NoError(t, err)
	require.Equal(t, saved, reloaded)
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
			require.Error(t, store.SaveNamedWorkspace(name, workspace, false))
			_, err := store.GetNamedWorkspace(name)
			require.Error(t, err)
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
	require.NoError(t, store.SaveNamedWorkspace(name, workspace, false))
	workspace.AppWindows[0].Geometry.Width = 900
	require.Error(t, store.SaveNamedWorkspace(name, workspace, false))
	saved, err := store.GetNamedWorkspace(name)
	require.NoError(t, err)
	require.Equal(t, 1200, saved.AppWindows[0].Geometry.Width)
	require.NoError(t, store.SaveNamedWorkspace(name, workspace, true))
	saved, err = store.GetNamedWorkspace(name)
	require.NoError(t, err)
	require.Equal(t, 900, saved.AppWindows[0].Geometry.Width)
}

func (w *namedWorkspaceTestWindows) OpenNamedWorkspace(_ context.Context, _ string, snapshot NamedWorkspace) error {
	w.opened = snapshot
	return nil
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
	require.NoError(t, store.SaveNamedWorkspace("Triage", sized(1200), false))
	require.NoError(t, store.SaveNamedWorkspace("Release", sized(900), false))
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(&namedWorkspaceTestWindows{}, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))

	require.Error(t, service.RenameNamedWorkspace(ctx, "another-window", "Triage", "Incident"))
	require.Error(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Missing", "Incident"))
	require.Error(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", "Release"))
	require.Error(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", "  "))
	require.NoError(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", "Triage"))
	require.NoError(t, service.RenameNamedWorkspace(ctx, "workspace-1", "Triage", " Incident "))

	restarted := NewUIStateStore()
	names, err := restarted.ListNamedWorkspaces()
	require.NoError(t, err)
	require.Equal(t, []string{"Incident", "Release"}, names)
	renamed, err := restarted.GetNamedWorkspace("Incident")
	require.NoError(t, err)
	require.Equal(t, 1200, renamed.AppWindows[0].Geometry.Width)
	untouched, err := restarted.GetNamedWorkspace("Release")
	require.NoError(t, err)
	require.Equal(t, 900, untouched.AppWindows[0].Geometry.Width)
}

// Deleting removes one saved workspace from disk and leaves the others openable.
func TestNamedWorkspaceDeleteRemovesOnlyTheNamedSnapshot(t *testing.T) {
	setTestConfigEnv(t)
	store := NewUIStateStore()
	workspace := NamedWorkspace{SchemaVersion: 1, AppWindows: []NamedWorkspaceAppWindow{{
		Geometry: panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1200, Height: 800}},
	}}}
	require.NoError(t, store.SaveNamedWorkspace("Triage", workspace, false))
	require.NoError(t, store.SaveNamedWorkspace("Release", workspace, false))
	service := NewDesktopService(DesktopServiceDependencies{NamedWorkspaces: NewNamedWorkspaceService(&namedWorkspaceTestWindows{}, store)})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))

	require.Error(t, service.DeleteNamedWorkspace(ctx, "another-window", "Triage"))
	require.Error(t, service.DeleteNamedWorkspace(ctx, "workspace-1", "Missing"))
	require.NoError(t, service.DeleteNamedWorkspace(ctx, "workspace-1", "Triage"))

	names, err := NewUIStateStore().ListNamedWorkspaces()
	require.NoError(t, err)
	require.Equal(t, []string{"Release"}, names)
	_, err = store.GetNamedWorkspace("Triage")
	require.Error(t, err)
	_, err = store.GetNamedWorkspace("Release")
	require.NoError(t, err)
}
