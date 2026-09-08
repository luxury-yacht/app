package main

import (
	"context"
	"errors"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"testing"
)

type sharedWorkspaceBridgeRecorder struct {
	args []any
	err  error
}

func (r *sharedWorkspaceBridgeRecorder) record(args ...any) error { r.args = args; return r.err }
func (r *sharedWorkspaceBridgeRecorder) AcknowledgePanelWorkspaceReady(windowName string) error {
	return r.record(windowName)
}
func (r *sharedWorkspaceBridgeRecorder) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	return panelwindow.WorkspaceSnapshot{Revision: 7}, r.record(windowName, clusterID)
}
func (r *sharedWorkspaceBridgeRecorder) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	return panelwindow.PanelOpenResult{Panel: panelwindow.WorkspacePanel{Tab: tab}, Render: true}, r.record(windowName, tab)
}
func (r *sharedWorkspaceBridgeRecorder) PublishDockedPanels(windowName string, groups []panelwindow.WorkspaceGroup) error {
	return r.record(windowName, groups)
}
func (r *sharedWorkspaceBridgeRecorder) OpenClusterWindow(windowName, clusterID string) error {
	return r.record(windowName, clusterID)
}
func (r *sharedWorkspaceBridgeRecorder) RequestClusterTabTransfer(windowName string, request panelwindow.ClusterTabTransferRequest) error {
	return r.record(windowName, request)
}
func (r *sharedWorkspaceBridgeRecorder) AcceptClusterTabTransfer(windowName, id string, snapshot panelwindow.ClusterViewSnapshot) error {
	return r.record(windowName, id, snapshot)
}
func (r *sharedWorkspaceBridgeRecorder) AcknowledgeClusterTabTransfer(windowName, id string) error {
	return r.record(windowName, id)
}
func (r *sharedWorkspaceBridgeRecorder) FailClusterTabTransfer(windowName, id string) error {
	return r.record(windowName, id)
}

func TestSharedWorkspaceBridgePreservesIdentityAndReportsUnboundRegistry(t *testing.T) {
	tab := panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "api", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: "production", Version: "v1", Kind: "Pod", Namespace: "payments", Name: "api"}}
	groups := []panelwindow.WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
	request := panelwindow.ClusterTabTransferRequest{TransferID: "transfer-1", SourceWindowName: "workspace-1", TargetWindowName: "workspace-2", ClusterID: "production"}
	snapshot := panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}", Groups: groups}
	cases := []struct {
		name string
		call func(*windowRegistryBridge) error
		want []any
	}{
		{"CloseClusterView", func(bridge *windowRegistryBridge) error {
			allowed, err := bridge.CloseClusterView(context.Background(), "workspace-1", "production")
			if err == nil {
				require.True(t, allowed)
			}
			return err
		}, []any{"workspace-1", "production"}},
		{"AcknowledgeClusterPanelClose", func(bridge *windowRegistryBridge) error {
			return bridge.AcknowledgeClusterPanelClose("workspace-1", "close-1", false)
		}, []any{"workspace-1", "close-1", false}},
		{"AcknowledgePanelWorkspaceReady", func(bridge *windowRegistryBridge) error { return bridge.AcknowledgePanelWorkspaceReady("workspace-1") }, []any{"workspace-1"}},
		{"GetPanelWorkspace", func(bridge *windowRegistryBridge) error {
			result, err := bridge.GetPanelWorkspace("workspace-1", "production")
			if err == nil {
				require.Equal(t, uint64(7), result.Revision)
			}
			return err
		}, []any{"workspace-1", "production"}},
		{"OpenPanelWorkspaceObject", func(bridge *windowRegistryBridge) error {
			result, err := bridge.OpenPanelWorkspaceObject("workspace-1", tab)
			if err == nil {
				require.Equal(t, tab, result.Panel.Tab)
				require.True(t, result.Render)
			}
			return err
		}, []any{"workspace-1", tab}},
		{"PublishDockedPanels", func(bridge *windowRegistryBridge) error { return bridge.PublishDockedPanels("workspace-1", groups) }, []any{"workspace-1", groups}},
		{"OpenClusterWindow", func(bridge *windowRegistryBridge) error {
			return bridge.OpenClusterWindow("workspace-1", "production")
		}, []any{"workspace-1", "production"}},
		{"RequestClusterTabTransfer", func(bridge *windowRegistryBridge) error {
			return bridge.RequestClusterTabTransfer("workspace-1", request)
		}, []any{"workspace-1", request}},
		{"AcceptClusterTabTransfer", func(bridge *windowRegistryBridge) error {
			return bridge.AcceptClusterTabTransfer("workspace-1", "transfer-1", snapshot)
		}, []any{"workspace-1", "transfer-1", snapshot}},
		{"AcknowledgeClusterTabTransfer", func(bridge *windowRegistryBridge) error {
			return bridge.AcknowledgeClusterTabTransfer("workspace-1", "transfer-1")
		}, []any{"workspace-1", "transfer-1"}},
		{"FailClusterTabTransfer", func(bridge *windowRegistryBridge) error {
			return bridge.FailClusterTabTransfer("workspace-1", "transfer-1")
		}, []any{"workspace-1", "transfer-1"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			bridge := &windowRegistryBridge{}
			require.ErrorContains(t, test.call(bridge), "registry is not available")
			recorder := &sharedWorkspaceBridgeRecorder{}
			bridge.bind(&recordingNativeWindowRegistry{SharedWorkspaceCommands: recorder})
			require.NoError(t, test.call(bridge))
			require.Equal(t, test.want, recorder.args)
			recorder.err = errors.New("shared directory failed")
			require.ErrorIs(t, test.call(bridge), recorder.err)
		})
	}
}

func (r *sharedWorkspaceBridgeRecorder) CloseClusterView(ctx context.Context, windowName, clusterID string) (bool, error) {
	return true, r.record(windowName, clusterID)
}
func (r *sharedWorkspaceBridgeRecorder) AcknowledgeClusterPanelClose(windowName, transactionID string, allowed bool) error {
	return r.record(windowName, transactionID, allowed)
}
