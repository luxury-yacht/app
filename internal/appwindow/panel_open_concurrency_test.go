package appwindow

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type panelRetentionBackend struct {
	*recordingLifecycleBackend
	retain func(string, string) error
}

func (b *panelRetentionBackend) RetainPanelCluster(reference, cluster string) error {
	if b.retain != nil {
		return b.retain(reference, cluster)
	}
	return nil
}

func TestPanelReadyDoesNotWaitForAnotherWindowsRetention(t *testing.T) {
	for _, blockedCall := range []int{1, 2} {
		t.Run(fmt.Sprintf("retain-%d", blockedCall), func(t *testing.T) {
			backend := &panelRetentionBackend{recordingLifecycleBackend: &recordingLifecycleBackend{windowClusters: map[string][]string{}}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			registry.panelOpenTimeout = 0
			registry.showWindow = func(string) bool { return true }
			registry.emitWindowEvent = func(string, string, any) bool { return true }
			var groups []PanelGroupSnapshot
			for _, cluster := range []string{"cluster-1", "cluster-2"} {
				source := registry.Create(len(groups) == 0).Name()
				backend.windowClusters[source] = []string{cluster}
				group := validPanelGroupSnapshot()
				group.ClusterID = cluster
				group.TransferID = "open-" + cluster
				group.SourceWindowName = source
				group.Tabs[0].ObjectRef.ClusterID = cluster
				_, _, err := registry.workspace.Open(group.Tabs[0], panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: source, GroupID: "right"})
				require.NoError(t, err)
				groups = append(groups, group)
			}
			first, err := registry.BeginPanelWindowOpen(groups[0])
			require.NoError(t, err)
			entered, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			t.Cleanup(unblock)
			calls := 0
			backend.retain = func(string, string) error {
				calls++
				if calls == blockedCall {
					close(entered)
					<-release
				}
				return nil
			}
			opening := make(chan error, 1)
			go func() { _, err := registry.BeginPanelWindowOpen(groups[1]); opening <- err }()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("panel open did not reach retention")
			}
			ready := make(chan error, 1)
			go func() {
				_, err := registry.AcknowledgePanelWindowReady(first.WindowName, first.Snapshot.TransferID)
				ready <- err
			}()
			select {
			case err := <-ready:
				if err != nil {
					t.Error(err)
				}
			case <-time.After(time.Second):
				t.Error("unrelated panel readiness waited behind the backend retention")
				unblock()
				<-ready
			}
			unblock()
			require.NoError(t, <-opening)
		})
	}
}

func TestPanelOpenRejectsSourceClosureAndCancellationDuringRetention(t *testing.T) {
	for _, change := range []string{"source-closes", "transfer-cancelled"} {
		t.Run(change, func(t *testing.T) {
			backend := &panelRetentionBackend{recordingLifecycleBackend: &recordingLifecycleBackend{}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			registry.panelOpenTimeout = 0
			snapshot := validPanelGroupSnapshot()
			snapshot.SourceWindowName = registry.Create(true).Name()
			_, _, err := registry.workspace.Open(snapshot.Tabs[0], panelwindow.PanelLocation{
				Kind: panelwindow.PanelLocationDocked, WindowName: snapshot.SourceWindowName, GroupID: "right",
			})
			require.NoError(t, err)
			registry.emitWindowEvent = func(string, string, any) bool { return true }
			registry.closeWindow = func(string) bool { return true }
			created := 0
			registry.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow {
				created++
				return nil
			}
			backend.retain = func(reference, cluster string) error {
				if reference == "panel-workspace:"+cluster {
					return nil
				}
				if change == "source-closes" {
					registry.lifecycle.BeginClose(snapshot.SourceWindowName)
				} else {
					require.NoError(t, registry.FailPanelWindowTransfer(snapshot.SourceWindowName, reference, snapshot.TransferID))
				}
				return nil
			}
			_, err = registry.BeginPanelWindowOpen(snapshot)
			require.Error(t, err)
			require.Zero(t, created, "a cancelled or detached source must not create a native window")
			require.Empty(t, registry.panels.Names(""))
			require.Equal(t, snapshot.SourceWindowName, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
		})
	}
}
