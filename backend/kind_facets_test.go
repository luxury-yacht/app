/*
 * backend/kind_facets_test.go
 *
 * Verifies the generated frontend kind facets table is current, and that every
 * served version a row lists passes the backend's own target checks for the
 * facets the row offers.
 */

package backend

import (
	"os"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/genkindfacets"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestGeneratedKindFacetsAreCurrent(t *testing.T) {
	want, err := genkindfacets.Render()
	if err != nil {
		t.Fatalf("render frontend kind facets: %v", err)
	}
	got, err := os.ReadFile("../frontend/src/shared/kinds/kindFacets.generated.ts")
	if err != nil {
		t.Fatalf("read generated frontend kind facets: %v", err)
	}
	if string(got) != string(want) {
		t.Fatal("generated frontend kind facets are stale; run `go generate ./backend`")
	}
}

// The frontend offers a row's facets for every version the row lists, so each
// listed version must pass the backend's own target check for each facet.
func TestKindFacetVersionsPassTheBackendTargetChecks(t *testing.T) {
	rows, err := genkindfacets.Rows()
	require.NoError(t, err)
	for _, row := range rows {
		for _, version := range row.Versions {
			target := ObjectActionTargetRef{Group: row.Group, Version: version, Kind: row.Kind, Namespace: "team-a", Name: "example"}
			label := row.Kind + " " + row.Group + "/" + version
			if row.Actions.Restart {
				_, err := validateAppsV1WorkloadAction("restart", target.Group, target.Version, target.Kind, actionRestartableWorkloadKinds)
				require.NoError(t, err, label)
			}
			if row.Actions.Scale {
				_, err := validateAppsV1WorkloadAction("scaling", target.Group, target.Version, target.Kind, actionScalableWorkloadKinds)
				require.NoError(t, err, label)
			}
			if row.Actions.Rollback {
				_, err := normalizeAppsV1WorkloadKind(target.Group, target.Version, target.Kind, revisionHistoryWorkloadKinds)
				require.NoError(t, err, label)
			}
			if row.Actions.Cordon || row.Actions.Drain {
				require.NoError(t, requireNodeActionTarget(ObjectActionCordon, target), label)
			}
			if row.Actions.PortForward {
				require.NoError(t, validatePortForwardTargetGVK(portForwardTargetRef{Group: row.Group, Version: version, Kind: row.Kind, Namespace: "team-a", Name: "example"}), label)
			}
			if row.Actions.Trigger || row.Actions.Suspend {
				// The CronJob handlers accept only the CronJob identity (workload_actions.go).
				require.Equal(t, cronjob.Identity.GVK(), schema.GroupVersionKind{Group: row.Group, Version: version, Kind: row.Kind}, label)
			}
			if row.Panel.Logs == "pod" || row.Panel.Logs == "owned-pods" {
				_, ok := containerLogTargets.Lookup(schema.GroupVersionKind{Group: row.Group, Version: version, Kind: row.Kind})
				require.True(t, ok, "%s: container logs reject this version", label)
			}
		}
	}
}
