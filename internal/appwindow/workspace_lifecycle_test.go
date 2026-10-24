package appwindow

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestFailedGroupDockIsNotDeliveredWhenTargetBecomesReady(t *testing.T) {
	backend := &recordingLifecycleBackend{}
	registry := NewRegistry(application.New(application.Options{}), backend)
	registry.panelOpenTimeout = 0
	owner := registry.Create(true)
	snapshot := validPanelGroupSnapshot()
	source := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	snapshot.SourceWindowName = source.WindowName
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	seedNativeGroup(t, registry.workspace, source.WindowName, snapshot)
	require.NoError(t, registry.PublishPanelWindowGroup(source.WindowName, nativeGroup(snapshot)))
	snapshot.TransferID = "late-dock"
	require.NoError(t, registry.BeginPanelWindowDock(source.WindowName, "right", snapshot))
	require.NoError(t, registry.FailPanelWindowTransfer(source.WindowName, source.WindowName, snapshot.TransferID))
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(owner.Name()))
	// A target that becomes ready later reads the directory; nothing targets it.
	workspace, err := registry.GetPanelWorkspace(owner.Name(), snapshot.ClusterID)
	require.NoError(t, err)
	require.Len(t, workspace.Panels, 1)
	require.Equal(t, source.WindowName, workspace.Panels[0].Location.WindowName)
	require.Zero(t, workspace.Panels[0].Transfer)
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
func (b *workspaceLockCheckingBackend) CommitClusterViewTransfer(source, target, cluster, transferID string) error {
	b.check()
	return b.recordingLifecycleBackend.CommitClusterViewTransfer(source, target, cluster, transferID)
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

func TestClusterTransferRequestsWaitForStagedMutation(t *testing.T) {
	backend := &workspaceLockCheckingBackend{recordingLifecycleBackend: &recordingLifecycleBackend{windowClusters: map[string][]string{}}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	registry.clusterTransferTimeout = 0
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	backend.windowClusters[source] = []string{"cluster-1", "cluster-2"}
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	first := panelwindow.ClusterTabTransferRequest{TransferID: "staging", SourceWindowName: source, TargetWindowName: target, ClusterID: "cluster-1"}
	require.NoError(t, registry.RequestClusterTabTransfer(source, first))
	entered, release := make(chan struct{}), make(chan struct{})
	backend.check = func() { close(entered); <-release }
	staged := make(chan error, 1)
	go func() {
		staged <- registry.AcceptClusterTabTransfer(source, first.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"})
	}()
	<-entered
	requested := make(chan error, 1)
	go func() {
		requested <- registry.RequestClusterTabTransfer(source, panelwindow.ClusterTabTransferRequest{
			TransferID: "next", SourceWindowName: source, TargetWindowName: target, ClusterID: "cluster-2",
		})
	}()
	select {
	case err := <-requested:
		require.NoError(t, err)
		t.Error("a new cluster request entered during a staged transfer mutation")
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	require.NoError(t, <-staged)
	if !t.Failed() {
		require.NoError(t, <-requested)
	}
}

// Closing the app view a dock-back targets declines the move at once: the
// native source keeps its panels and is live again without waiting for the
// dock timeout. Closing another app view leaves the dock pending.
func TestClosingADockTargetDeclinesTheDockAtOnce(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	owner := registry.Create(true).Name()
	other := registry.Create(true).Name()
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.showWindow = func(string) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	dock := snapshot
	dock.SourceWindowName = descriptor.WindowName
	dock.TransferID = "dock-to-closing-view"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "right", dock))
	target := registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Transfer.Target.WindowName
	unrelated := other
	if target == other {
		unrelated = owner
	}

	registry.authorizeClose(unrelated)
	registry.handleClosing(nil, unrelated)
	require.Equal(t, PanelWindowStateDocking, registry.panels.State(descriptor.WindowName))

	registry.authorizeClose(target)
	registry.handleClosing(nil, target)

	require.Equal(t, PanelWindowStateLive, registry.panels.State(descriptor.WindowName))
	panel := registry.workspace.Snapshot(snapshot.ClusterID).Panels[0]
	require.Equal(t, descriptor.WindowName, panel.Location.WindowName)
	require.Zero(t, panel.Transfer)
}
