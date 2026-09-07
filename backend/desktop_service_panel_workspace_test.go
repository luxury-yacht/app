package backend

import (
	"context"
	"errors"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"testing"
)

type sharedWorkspaceRecorder struct {
	args []any
	err  error
}

func (r *sharedWorkspaceRecorder) record(args ...any) error { r.args = args; return r.err }
func (r *sharedWorkspaceRecorder) AcknowledgePanelWorkspaceReady(windowName string) error {
	return r.record(windowName)
}
func (r *sharedWorkspaceRecorder) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	return panelwindow.WorkspaceSnapshot{Revision: 7}, r.record(windowName, clusterID)
}
func (r *sharedWorkspaceRecorder) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	return panelwindow.PanelOpenResult{Panel: panelwindow.WorkspacePanel{Tab: tab}, Render: true}, r.record(windowName, tab)
}
func (r *sharedWorkspaceRecorder) PublishDockedPanels(windowName string, groups []panelwindow.WorkspaceGroup) error {
	return r.record(windowName, groups)
}
func (r *sharedWorkspaceRecorder) RequestClusterTabTransfer(windowName string, request panelwindow.ClusterTabTransferRequest) error {
	return r.record(windowName, request)
}
func (r *sharedWorkspaceRecorder) AcceptClusterTabTransfer(windowName, id string, snapshot panelwindow.ClusterViewSnapshot) error {
	return r.record(windowName, id, snapshot)
}
func (r *sharedWorkspaceRecorder) AcknowledgeClusterTabTransfer(windowName, id string) error {
	return r.record(windowName, id)
}
func (r *sharedWorkspaceRecorder) FailClusterTabTransfer(windowName, id string) error {
	return r.record(windowName, id)
}

func TestSharedPanelWorkspaceBoundaryAuthenticatesAndPreservesEveryCommand(t *testing.T) {
	tab := panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "api", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: "production", Version: "v1", Kind: "Pod", Namespace: "payments", Name: "api"}}
	groups := []panelwindow.WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
	request := panelwindow.ClusterTabTransferRequest{TransferID: "transfer-1", SourceWindowName: "workspace-1", TargetWindowName: "workspace-2", ClusterID: "production"}
	snapshot := panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}", Groups: groups}
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("workspace-1"))
	cases := []struct {
		name string
		call func(*DesktopService, context.Context, string) error
		want []any
	}{
		{"AcknowledgePanelWorkspaceReady", func(service *DesktopService, ctx context.Context, caller string) error {
			return service.AcknowledgePanelWorkspaceReady(ctx, caller)
		}, []any{"workspace-1"}},
		{"GetPanelWorkspace", func(service *DesktopService, ctx context.Context, caller string) error {
			result, err := service.GetPanelWorkspace(ctx, caller, "production")
			if err == nil {
				require.Equal(t, uint64(7), result.Revision)
			}
			return err
		}, []any{"workspace-1", "production"}},
		{"OpenPanelWorkspaceObject", func(service *DesktopService, ctx context.Context, caller string) error {
			result, err := service.OpenPanelWorkspaceObject(ctx, caller, tab)
			if err == nil {
				require.Equal(t, tab, result.Panel.Tab)
				require.True(t, result.Render)
			}
			return err
		}, []any{"workspace-1", tab}},
		{"PublishDockedPanels", func(service *DesktopService, ctx context.Context, caller string) error {
			return service.PublishDockedPanels(ctx, caller, groups)
		}, []any{"workspace-1", groups}},
		{"RequestClusterTabTransfer", func(service *DesktopService, ctx context.Context, caller string) error {
			return service.RequestClusterTabTransfer(ctx, caller, request)
		}, []any{"workspace-1", request}},
		{"AcceptClusterTabTransfer", func(service *DesktopService, ctx context.Context, caller string) error {
			return service.AcceptClusterTabTransfer(ctx, caller, "transfer-1", snapshot)
		}, []any{"workspace-1", "transfer-1", snapshot}},
		{"AcknowledgeClusterTabTransfer", func(service *DesktopService, ctx context.Context, caller string) error {
			return service.AcknowledgeClusterTabTransfer(ctx, caller, "transfer-1")
		}, []any{"workspace-1", "transfer-1"}},
		{"FailClusterTabTransfer", func(service *DesktopService, ctx context.Context, caller string) error {
			return service.FailClusterTabTransfer(ctx, caller, "transfer-1")
		}, []any{"workspace-1", "transfer-1"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			recorder := &sharedWorkspaceRecorder{}
			shell := NewDesktopShell(nil, func() bool { return false }, nil, nil, DesktopShellBindings{PanelWorkspace: recorder})
			service := &DesktopService{panelWindows: shell}
			require.Error(t, test.call(service, ctx, "workspace-other"))
			require.Nil(t, recorder.args)
			require.NoError(t, test.call(service, context.Background(), "workspace-1"))
			require.Equal(t, test.want, recorder.args)
			require.NoError(t, test.call(service, ctx, "workspace-1"))
			require.Equal(t, test.want, recorder.args)
			recorder.err = errors.New("shared directory failed")
			require.ErrorIs(t, test.call(service, ctx, "workspace-1"), recorder.err)
			service.panelWindows = NewDesktopShell(nil, nil, nil, nil)
			require.ErrorContains(t, test.call(service, ctx, "workspace-1"), "registry is not available")
		})
	}
}
