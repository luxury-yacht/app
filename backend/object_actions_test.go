/*
 * backend/object_actions_test.go
 *
 * Verifies object action execution, target identity validation, and the
 * frontend/backend RunObjectAction action-name contract.
 */

package backend

import (
	"os"
	"regexp"
	"strings"
	"testing"
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

func TestFrontendObjectActionContractMatchesBackend(t *testing.T) {
	payload, err := os.ReadFile("../frontend/src/shared/actions/objectActionContract.ts")
	if err != nil {
		t.Fatalf("read frontend object action contract: %v", err)
	}

	source := string(payload)
	start := strings.Index(source, "export const OBJECT_ACTIONS = {")
	if start < 0 {
		t.Fatalf("frontend OBJECT_ACTIONS contract not found")
	}
	end := strings.Index(source[start:], "} as const;")
	if end < 0 {
		t.Fatalf("frontend OBJECT_ACTIONS contract terminator not found")
	}
	block := source[start : start+end]

	matches := regexp.MustCompile(`\b([a-zA-Z0-9_]+): '([^']+)'`).FindAllStringSubmatch(block, -1)
	frontendActions := make(map[string]struct{})
	for _, match := range matches {
		frontendActions[match[2]] = struct{}{}
	}

	if len(frontendActions) == 0 {
		t.Fatalf("failed to parse frontend OBJECT_ACTIONS contract")
	}
	for action := range frontendActions {
		if _, ok := frontendObjectActions[action]; !ok {
			t.Fatalf("frontend action %q is missing from backend contract", action)
		}
	}
	for action := range frontendObjectActions {
		if _, ok := frontendActions[action]; !ok {
			t.Fatalf("backend frontend action %q is missing from frontend contract", action)
		}
	}
}
