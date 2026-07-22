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
