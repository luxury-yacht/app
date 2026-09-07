package appwindow

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func clusterCloseFixture(t *testing.T) (*Registry, *recordingLifecycleBackend, string, []string) {
	t.Helper()
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1", "cluster-2"}
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	var windows []string
	for i, id := range []string{"one", "two", "other"} {
		snapshot := validPanelGroupSnapshot()
		snapshot.SourceWindowName = source
		snapshot.TransferID, snapshot.GroupID = id, id
		snapshot.Tabs[0].PanelID, snapshot.Tabs[0].ObjectRef.Name = id, id
		snapshot.ActivePanelID = id
		if i == 2 {
			snapshot.ClusterID = "cluster-2"
			snapshot.Tabs[0].ObjectRef.ClusterID = "cluster-2"
		}
		descriptor, err := beginTestPanelWindow(t, registry, snapshot)
		require.NoError(t, err)
		_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
		require.NoError(t, err)
		windows = append(windows, descriptor.WindowName)
	}
	return registry, backend, source, windows
}

func TestClusterCloseWaitsForAllPanelGuardsAndClosesOnlyItsCluster(t *testing.T) {
	registry, backend, source, windows := clusterCloseFixture(t)
	requests := make(chan panelwindow.ClusterPanelCloseEvent, 3)
	var closed []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	registry.emitWindowEvent = func(_ string, event string, payload any) bool {
		if event == panelwindow.ClusterPanelCloseRequestedEventName {
			requests <- payload.(panelwindow.ClusterPanelCloseEvent)
		}
		return true
	}
	done := make(chan bool, 1)
	go func() {
		allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
		if err != nil {
			t.Error(err)
		}
		done <- allowed
	}()
	var first, second panelwindow.ClusterPanelCloseEvent
	select {
	case first = <-requests:
	case <-time.After(time.Second):
		t.Fatal("cluster close never requested native panel guards")
	}
	select {
	case second = <-requests:
	case <-time.After(time.Second):
		t.Fatal("second panel guard was not requested")
	}
	require.Equal(t, "cluster-1", first.ClusterID)
	require.NoError(t, registry.AcknowledgeClusterPanelClose(first.WindowName, first.TransactionID, true))
	select {
	case <-done:
		t.Fatal("closed before every panel approved")
	default:
	}
	require.Empty(t, closed)
	require.NoError(t, registry.AcknowledgeClusterPanelClose(second.WindowName, second.TransactionID, true))
	select {
	case allowed := <-done:
		require.True(t, allowed)
	case <-time.After(time.Second):
		t.Fatal("cluster close did not settle")
	}
	require.ElementsMatch(t, windows[:2], closed)
	require.Equal(t, []string{windows[2]}, registry.panels.Names(""))
	require.Empty(t, registry.workspace.Snapshot("cluster-1").Panels)
	require.NotEmpty(t, registry.workspace.Snapshot("cluster-2").Panels)
	require.Contains(t, backend.releasedPanelReferences, "panel-workspace:cluster-1")
	require.True(t, registry.lifecycle.Contains(source), "closing a tab must not close its app window")
}

func TestClusterCloseDenialOrCancellationPreservesEveryPanel(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "denied", true: "cancelled"}[cancel], func(t *testing.T) {
			registry, _, source, windows := clusterCloseFixture(t)
			registry.closeWindow = func(string) bool { t.Error("must not close a panel before all guards approve"); return true }
			requests := make(chan panelwindow.ClusterPanelCloseEvent, 3)
			registry.emitWindowEvent = func(_ string, event string, payload any) bool {
				if event == panelwindow.ClusterPanelCloseRequestedEventName {
					requests <- payload.(panelwindow.ClusterPanelCloseEvent)
				}
				return true
			}
			ctx, stop := context.WithCancel(context.Background())
			defer stop()
			done := make(chan bool, 1)
			go func() { allowed, _ := registry.CloseClusterView(ctx, source, "cluster-1"); done <- allowed }()
			var request panelwindow.ClusterPanelCloseEvent
			select {
			case request = <-requests:
			case <-time.After(time.Second):
				t.Fatal("no native preflight")
			}
			if cancel {
				stop()
			} else {
				require.NoError(t, registry.AcknowledgeClusterPanelClose(request.WindowName, request.TransactionID, false))
			}
			select {
			case allowed := <-done:
				require.False(t, allowed)
			case <-time.After(time.Second):
				t.Fatal("close did not settle")
			}
			require.ElementsMatch(t, windows, registry.panels.Names(""))
			require.Error(t, registry.AcknowledgeClusterPanelClose(request.WindowName, request.TransactionID, true))
		})
	}
}

func TestClusterCloseKeepsSharedPanelsForAnotherAppView(t *testing.T) {
	registry, backend, source, windows := clusterCloseFixture(t)
	peer := registry.Create(false).Name()
	backend.windowClusters[peer] = []string{"cluster-1"}
	registry.closeWindow = func(string) bool { t.Error("shared panels must remain open"); return true }
	registry.emitWindowEvent = func(string, string, any) bool { t.Error("shared panels do not need close preflight"); return true }
	allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
	require.NoError(t, err)
	require.True(t, allowed)
	require.ElementsMatch(t, windows, registry.panels.Names(""))
}

func TestClusterCloseRechecksSourceAndPeerViewsAfterPanelPreflight(t *testing.T) {
	for _, change := range []string{"peer-opens", "source-closes", "panel-disappears"} {
		t.Run(change, func(t *testing.T) {
			registry, backend, source, windows := clusterCloseFixture(t)
			registry.closeWindow = func(string) bool { t.Error("changed workspace must not destroy shared panels"); return true }
			registry.emitWindowEvent = func(_ string, name string, payload any) bool {
				if name != panelwindow.ClusterPanelCloseRequestedEventName {
					return true
				}
				event := payload.(panelwindow.ClusterPanelCloseEvent)
				if event.WindowName == windows[1] {
					switch change {
					case "peer-opens":
						backend.windowClusters[registry.Create(false).Name()] = []string{"cluster-1"}
					case "source-closes":
						backend.windowClusters[source] = []string{"cluster-2"}
					case "panel-disappears":
						registry.panels.Remove(windows[0])
					}
				}
				require.NoError(t, registry.AcknowledgeClusterPanelClose(event.WindowName, event.TransactionID, true))
				return true
			}
			allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
			if change == "peer-opens" {
				require.NoError(t, err)
				require.True(t, allowed)
			} else {
				require.Error(t, err)
				require.False(t, allowed)
			}
		})
	}
}

func TestClusterCloseRejectsUnavailableOrTransferringParticipants(t *testing.T) {
	for _, scenario := range []string{"foreign-source", "unavailable-panel", "cluster-transfer", "native-transfer", "duplicate-close", "wrong-acknowledgement"} {
		t.Run(scenario, func(t *testing.T) {
			registry, _, source, windows := clusterCloseFixture(t)
			registry.closeWindow = func(string) bool { t.Error("invalid close must not destroy panels"); return true }
			switch scenario {
			case "foreign-source":
				source = "unknown"
			case "cluster-transfer":
				require.NoError(t, registry.RequestClusterTabTransfer(source, panelwindow.ClusterTabTransferRequest{TransferID: "move", SourceWindowName: source, ClusterID: "cluster-1"}))
				t.Cleanup(func() { _ = registry.FailClusterTabTransfer(source, "move") })
			case "native-transfer":
				registry.panels.Remove(windows[0])
				snapshot := validPanelGroupSnapshot()
				snapshot.TransferID = "opening"
				snapshot.SourceWindowName = source
				_, err := beginTestPanelWindow(t, registry, snapshot)
				require.NoError(t, err)
			}
			registry.emitWindowEvent = func(_ string, name string, payload any) bool {
				if name != panelwindow.ClusterPanelCloseRequestedEventName {
					return true
				}
				event := payload.(panelwindow.ClusterPanelCloseEvent)
				if scenario == "duplicate-close" {
					allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
					require.Error(t, err)
					require.False(t, allowed)
				}
				if scenario == "wrong-acknowledgement" {
					require.Error(t, registry.AcknowledgeClusterPanelClose("foreign", event.TransactionID, true))
				}
				if scenario == "unavailable-panel" {
					return false
				}
				require.NoError(t, registry.AcknowledgeClusterPanelClose(event.WindowName, event.TransactionID, false))
				return true
			}
			allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
			require.False(t, allowed)
			if scenario != "duplicate-close" && scenario != "wrong-acknowledgement" {
				require.Error(t, err)
			}
			require.Empty(t, registry.clusterPanelCloses)
		})
	}
}

func TestClusterCloseDiscardsRetainedAndDockedPanelsWithoutNativeWindows(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1"}
	tab := validPanelGroupSnapshot().Tabs[0]
	_, _, err := registry.workspace.Open(tab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationRetained, GroupID: "right"})
	require.NoError(t, err)
	allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
	require.NoError(t, err)
	require.True(t, allowed)
	require.Empty(t, registry.workspace.Snapshot("cluster-1").Panels)
	require.Contains(t, backend.releasedPanelReferences, "panel-workspace:cluster-1")
}

func TestClosingDuplicateClusterViewsRecordsRemovalBeforeCheckingTheFinalView(t *testing.T) {
	registry, backend, source, windows := clusterCloseFixture(t)
	peer := registry.Create(false).Name()
	backend.windowClusters[peer] = []string{"cluster-1"}
	var closed []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
	require.NoError(t, err)
	require.True(t, allowed)
	require.NotContains(t, backend.WindowClusterIDs(source), "cluster-1", "the first view must leave before another close checks whether it is last")
	require.Empty(t, closed)
	registry.emitWindowEvent = func(_ string, name string, payload any) bool {
		if name == panelwindow.ClusterPanelCloseRequestedEventName {
			event := payload.(panelwindow.ClusterPanelCloseEvent)
			require.NoError(t, registry.AcknowledgeClusterPanelClose(event.WindowName, event.TransactionID, true))
		}
		return true
	}
	allowed, err = registry.CloseClusterView(context.Background(), peer, "cluster-1")
	require.NoError(t, err)
	require.True(t, allowed)
	require.ElementsMatch(t, windows[:2], closed)
	require.Empty(t, backend.WindowClusterIDs(peer))
}
