package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestFailedGroupDockIsNotDeliveredWhenTargetBecomesReady(t *testing.T) {
	backend := &recordingLifecycleBackend{}
	registry := NewRegistry(application.New(application.Options{}), backend)
	registry.panelOpenTimeout = 0
	owner := registry.Create(true)
	source := livePanelWindowForTabTransfer(t, registry.panels, validPanelGroupSnapshot())
	snapshot := source.Snapshot
	snapshot.SourceWindowName = source.WindowName
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	require.NoError(t, registry.UpdatePanelWindowSnapshot(source.WindowName, snapshot))
	snapshot.TransferID = "late-dock"
	require.NoError(t, registry.BeginPanelWindowDock(source.WindowName, "right", snapshot))
	require.NoError(t, registry.FailPanelWindowTransfer(source.WindowName, source.WindowName, snapshot.TransferID))
	insertions := 0
	registry.emitWindowEvent = func(_ string, name string, _ any) bool {
		if name == panelwindow.WindowDockRequestedEventName {
			insertions++
		}
		return true
	}
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(owner.Name()))
	require.Zero(t, insertions)
	require.Equal(t, PanelWindowStateLive, registry.panels.State(source.WindowName))
}

func TestAppCreatedForPanelClusterUsesAppGeometry(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	registry.panelOpenTimeout = 0
	peer := registry.Create(true)
	backend.windowClusters[peer.Name()] = []string{"other-cluster"}
	source := livePanelWindowForTabTransfer(t, registry.panels, validPanelGroupSnapshot())
	var geometrySource string
	registry.windowGeometry = func(name string) (geometry, bool) {
		geometrySource = name
		if name == peer.Name() {
			return geometry{Width: 1400, Height: 900}, true
		}
		return geometry{Width: 400, Height: 300}, true
	}
	create := registry.newWindow
	var options application.WebviewWindowOptions
	registry.newWindow = func(value application.WebviewWindowOptions) *application.WebviewWindow {
		options = value
		return create(value)
	}
	_, err := registry.appWindowForCluster(source.ClusterID, source.WindowName)
	require.NoError(t, err)
	require.Equal(t, peer.Name(), geometrySource)
	require.Equal(t, 1400, options.Width)
	require.Equal(t, 900, options.Height)
}

type workspaceLockCheckingBackend struct {
	*recordingLifecycleBackend
	check func()
}

func (b *workspaceLockCheckingBackend) RetainPanelCluster(string, string) error {
	b.check()
	return nil
}
func (b *workspaceLockCheckingBackend) ReleasePanelCluster(reference string) error {
	b.check()
	return b.recordingLifecycleBackend.ReleasePanelCluster(reference)
}
func (b *workspaceLockCheckingBackend) CloseClusterView(window, cluster string) error {
	b.check()
	return b.recordingLifecycleBackend.CloseClusterView(window, cluster)
}

func TestPanelCommandsReleaseWorkspaceLockBeforeBackendMutation(t *testing.T) {
	for _, action := range []string{"open", "publish", "float", "close-shared", "close-panel"} {
		t.Run(action, func(t *testing.T) {
			backend := &workspaceLockCheckingBackend{recordingLifecycleBackend: &recordingLifecycleBackend{}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			registry.panelOpenTimeout = 0
			source := registry.Create(true)
			registry.Create(false)
			registry.emitWindowEvent = func(string, string, any) bool { return true }
			registry.closeWindow = func(string) bool { return true }
			snapshot := validPanelGroupSnapshot()
			snapshot.SourceWindowName = source.Name()
			_, _, err := registry.workspace.Open(snapshot.Tabs[0], panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: source.Name(), GroupID: "right"})
			require.NoError(t, err)
			held := false
			backend.check = func() {
				if registry.workspaceMu.TryLock() {
					registry.workspaceMu.Unlock()
				} else {
					held = true
				}
			}
			switch action {
			case "open":
				_, err = registry.OpenPanelWorkspaceObject(source.Name(), snapshot.Tabs[0])
			case "publish":
				err = registry.PublishDockedPanels(source.Name(), []panelwindow.WorkspaceGroup{{ClusterID: snapshot.ClusterID, GroupID: "right", Tabs: snapshot.Tabs, ActivePanelID: snapshot.ActivePanelID}})
			case "float":
				_, err = registry.BeginPanelWindowOpen(snapshot)
			case "close-shared":
				_, err = registry.CloseClusterView(t.Context(), source.Name(), snapshot.ClusterID)
			case "close-panel":
				native := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
				registry.workspace.RemoveWindow(source.Name())
				err = registry.AcknowledgePanelWindowClose(native.WindowName)
			}
			require.NoError(t, err)
			require.False(t, held, "a backend selection mutation can wait behind another window's connection")
		})
	}
}

func (b *workspaceLockCheckingBackend) StageClusterViewTransfer(source, target, cluster string) (bool, error) {
	b.check()
	return b.recordingLifecycleBackend.StageClusterViewTransfer(source, target, cluster)
}
func (b *workspaceLockCheckingBackend) CommitClusterViewTransfer(source, target, cluster string, groups []panelwindow.WorkspaceGroup) error {
	b.check()
	return b.recordingLifecycleBackend.CommitClusterViewTransfer(source, target, cluster, groups)
}
func (b *workspaceLockCheckingBackend) CancelClusterViewTransfer(target, cluster string) error {
	b.check()
	return b.recordingLifecycleBackend.CancelClusterViewTransfer(target, cluster)
}

func TestClusterTransfersReleaseWorkspaceLockBeforeBackendMutation(t *testing.T) {
	for _, action := range []string{"accept", "commit", "cancel", "close"} {
		t.Run(action, func(t *testing.T) {
			backend := &workspaceLockCheckingBackend{recordingLifecycleBackend: &recordingLifecycleBackend{windowClusters: map[string][]string{}}, check: func() {}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			registry.clusterTransferTimeout = 0
			source, target := registry.Create(true).Name(), registry.Create(false).Name()
			backend.windowClusters[source] = []string{"cluster-1"}
			registry.emitWindowEvent = func(string, string, any) bool { return true }
			request := panelwindow.ClusterTabTransferRequest{TransferID: action, ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
			require.NoError(t, registry.RequestClusterTabTransfer(source, request))
			held := false
			check := func() {
				if registry.workspaceMu.TryLock() {
					registry.workspaceMu.Unlock()
				} else {
					held = true
				}
			}
			if action == "accept" {
				backend.check = check
			}
			require.NoError(t, registry.AcceptClusterTabTransfer(source, action, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
			backend.check = check
			switch action {
			case "commit":
				require.NoError(t, registry.AcknowledgeClusterTabTransfer(target, action))
			case "cancel":
				require.NoError(t, registry.FailClusterTabTransfer(source, action))
			case "close":
				require.NoError(t, registry.failClusterTransfersForWindow(source))
			}
			require.False(t, held, "cluster transfers must leave unrelated panel operations usable while the backend waits")
		})
	}
}

func TestPanelOpenRevalidatesRemovalAfterBackendWait(t *testing.T) {
	backend := &workspaceLockCheckingBackend{recordingLifecycleBackend: &recordingLifecycleBackend{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	tab := validPanelGroupSnapshot().Tabs[0]
	removed := false
	backend.check = func() {
		if !removed {
			removed = true
			registry.workspace.RemoveCluster(tab.ObjectRef.ClusterID)
		}
	}
	_, err := registry.OpenPanelWorkspaceObject(source, tab)
	require.ErrorContains(t, err, "no longer displays")
	require.Empty(t, registry.workspace.Snapshot(tab.ObjectRef.ClusterID).Panels)
	require.False(t, registry.workspace.HasClusterReference(tab.ObjectRef.ClusterID))
}
