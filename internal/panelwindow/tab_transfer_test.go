package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func validTabTransferRequest() TabTransferRequest {
	return TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: "panel-1",
		TargetWindowName: "panel-2",
		OwnerWindowName:  "workspace-1",
		ClusterID:        "cluster-1",
		SourceGroupID:    "group-1",
		TargetGroupID:    "group-2",
		TargetKind:       TabTransferTargetPanelWindow,
		Tab: TabSnapshot{
			Kind:       TabKindObject,
			PanelID:    "panel-tab-1",
			ActiveView: "details",
			ObjectRef: ObjectReference{
				ClusterID: "cluster-1",
				Group:     "apps",
				Version:   "v1",
				Kind:      "Deployment",
				Namespace: "default",
				Name:      "api",
			},
		},
	}
}

func TestValidateTabTransferRequestAcceptsEveryTargetKind(t *testing.T) {
	nativeTarget := validTabTransferRequest()
	require.NoError(t, ValidateTabTransferRequest(nativeTarget))

	workspaceTarget := validTabTransferRequest()
	workspaceTarget.TargetKind = TabTransferTargetWorkspace
	workspaceTarget.TargetWindowName = workspaceTarget.OwnerWindowName
	workspaceTarget.TargetGroupID = "bottom"
	require.NoError(t, ValidateTabTransferRequest(workspaceTarget))

	newWindowTarget := validTabTransferRequest()
	newWindowTarget.TargetKind = TabTransferTargetNewWindow
	newWindowTarget.TargetWindowName = ""
	require.NoError(t, ValidateTabTransferRequest(newWindowTarget))
}

func TestValidateTabTransferRequestRejectsIncompleteOrInconsistentIdentity(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*TabTransferRequest)
	}{
		{name: "missing transfer", mutate: func(request *TabTransferRequest) { request.TransferID = "" }},
		{name: "negative index", mutate: func(request *TabTransferRequest) { request.TargetIndex = -1 }},
		{name: "invalid tab", mutate: func(request *TabTransferRequest) { request.Tab.ObjectRef.Version = "" }},
		{
			name: "invalid workspace target",
			mutate: func(request *TabTransferRequest) {
				request.TargetKind = TabTransferTargetWorkspace
			},
		},
		{
			name: "missing native target",
			mutate: func(request *TabTransferRequest) {
				request.TargetWindowName = ""
			},
		},
		{
			name: "new window names existing target",
			mutate: func(request *TabTransferRequest) {
				request.TargetKind = TabTransferTargetNewWindow
			},
		},
		{
			name: "unknown target kind",
			mutate: func(request *TabTransferRequest) {
				request.TargetKind = "unknown"
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := validTabTransferRequest()
			test.mutate(&request)
			require.Error(t, ValidateTabTransferRequest(request))
		})
	}
}
