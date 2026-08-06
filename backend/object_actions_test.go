/*
 * backend/object_actions_test.go
 *
 * Verifies object action execution, target identity validation, and the
 * frontend/backend RunObjectAction action-name contract.
 */

package backend

import (
	"os"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/genobjectactions"
)

func TestRunObjectActionRequiresFullTargetIdentity(t *testing.T) {
	app := NewApp()

	tests := []struct {
		name    string
		req     ObjectActionRequest
		wantErr string
	}{
		{
			name: "missing cluster",
			req: ObjectActionRequest{
				Action: ObjectActionDelete,
				Target: objectActionTarget("", "", "v1", "Pod", "default", "api"),
			},
			wantErr: "clusterId",
		},
		{
			name: "missing version",
			req: ObjectActionRequest{
				Action: ObjectActionDelete,
				Target: objectActionTarget("cluster-a", "", "", "Pod", "default", "api"),
			},
			wantErr: "missing version",
		},
		{
			name: "missing non-core group",
			req: ObjectActionRequest{
				Action: ObjectActionDelete,
				Target: objectActionTarget("cluster-a", "", "v1", "Deployment", "default", "api"),
			},
			wantErr: "missing group",
		},
		{
			name: "missing action option",
			req: ObjectActionRequest{
				Action: ObjectActionScale,
				Target: objectActionTarget("cluster-a", "apps", "v1", "Deployment", "default", "api"),
			},
			wantErr: "requires replicas",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := app.RunObjectAction(tt.req)
			if err == nil {
				t.Fatalf("expected error containing %q", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestRunObjectActionValidatesActionSpecificRequirements(t *testing.T) {
	app := NewApp()
	replicas := 2
	suspend := true
	revision := int64(3)
	portForward := ObjectActionPortForwardOptions{ContainerPort: 8080}
	debugContainer := ObjectActionDebugContainerOptions{Image: "busybox"}

	tests := []struct {
		name    string
		req     ObjectActionRequest
		wantErr string
	}{
		{name: "unsupported action", req: ObjectActionRequest{Action: "unknown"}, wantErr: "unsupported object action"},
		{name: "restart namespace", req: namespacedActionRequest(ObjectActionRestart, "apps", "v1", "Deployment"), wantErr: "requires namespace"},
		{name: "scale namespace", req: actionRequestWithReplicas(replicas), wantErr: "requires namespace"},
		{name: "trigger namespace", req: namespacedActionRequest(ObjectActionTrigger, "batch", "v1", "CronJob"), wantErr: "requires namespace"},
		{name: "suspend option", req: namespacedActionRequest(ObjectActionSuspend, "batch", "v1", "CronJob"), wantErr: "requires suspend"},
		{name: "suspend namespace", req: actionRequestWithSuspend(suspend), wantErr: "requires namespace"},
		{name: "port forward option", req: namespacedActionRequest(ObjectActionStartPortForward, "", "v1", "Pod"), wantErr: "requires portForward"},
		{name: "port forward namespace", req: actionRequestWithPortForward(portForward), wantErr: "requires namespace"},
		{name: "debug option", req: namespacedActionRequest(ObjectActionCreateDebugContainer, "", "v1", "Pod"), wantErr: "requires debugContainer"},
		{name: "debug namespace", req: actionRequestWithDebugContainer(debugContainer), wantErr: "requires namespace"},
		{name: "rollback option", req: namespacedActionRequest(ObjectActionRollback, "apps", "v1", "Deployment"), wantErr: "requires revision"},
		{name: "rollback namespace", req: actionRequestWithRevision(revision), wantErr: "requires namespace"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := app.RunObjectAction(tt.req)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestRunObjectActionInvokesStartDrainAndDebugHandlers(t *testing.T) {
	app := NewApp()

	drainResponse, err := app.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionStartDrain,
		Target: objectActionTarget("missing-cluster", "", "v1", "Node", "", "worker-a"),
	})
	if err == nil {
		t.Fatal("expected start drain to reach cluster resolution")
	}
	if drainResponse.JobID != "" {
		t.Fatalf("unexpected drain job ID %q", drainResponse.JobID)
	}

	debugResponse, err := app.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionCreateDebugContainer,
		Target: objectActionTarget("missing-cluster", "", "v1", "Pod", "default", "api"),
		DebugContainer: &ObjectActionDebugContainerOptions{
			Image: "busybox",
		},
	})
	if err == nil {
		t.Fatal("expected debug container to reach cluster resolution")
	}
	if debugResponse.DebugContainer != nil {
		t.Fatal("unexpected debug container response")
	}
}

func namespacedActionRequest(action, group, version, kind string) ObjectActionRequest {
	return ObjectActionRequest{
		Action: action,
		Target: objectActionTarget("cluster-a", group, version, kind, "", "demo"),
	}
}

func actionRequestWithReplicas(replicas int) ObjectActionRequest {
	request := namespacedActionRequest(ObjectActionScale, "apps", "v1", "Deployment")
	request.Replicas = &replicas
	return request
}

func actionRequestWithSuspend(suspend bool) ObjectActionRequest {
	request := namespacedActionRequest(ObjectActionSuspend, "batch", "v1", "CronJob")
	request.Suspend = &suspend
	return request
}

func actionRequestWithPortForward(options ObjectActionPortForwardOptions) ObjectActionRequest {
	request := namespacedActionRequest(ObjectActionStartPortForward, "", "v1", "Pod")
	request.PortForward = &options
	return request
}

func actionRequestWithDebugContainer(options ObjectActionDebugContainerOptions) ObjectActionRequest {
	request := namespacedActionRequest(ObjectActionCreateDebugContainer, "", "v1", "Pod")
	request.DebugContainer = &options
	return request
}

func actionRequestWithRevision(revision int64) ObjectActionRequest {
	request := namespacedActionRequest(ObjectActionRollback, "apps", "v1", "Deployment")
	request.Revision = &revision
	return request
}

func TestGeneratedObjectActionContractIsCurrent(t *testing.T) {
	want, err := genobjectactions.Render()
	if err != nil {
		t.Fatalf("render frontend object action contract: %v", err)
	}
	got, err := os.ReadFile("../frontend/src/shared/actions/objectActions.generated.ts")
	if err != nil {
		t.Fatalf("read generated frontend object action contract: %v", err)
	}
	if string(got) != string(want) {
		t.Fatal("generated frontend object action contract is stale; run `go generate ./backend`")
	}
}
