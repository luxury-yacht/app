package system

import (
	"errors"
	"testing"
)

// TestIngestPermissionFilterConservative pins the conservative gating contract: the
// ingest reflector for a kind is skipped ONLY on a confirmed denial (allowed==false with
// no error). On an SSAR error the filter returns true so the reflector still runs — the
// per-kind sync-deadline degrade is the backstop, so a transient permission blip never
// wrongly excludes a kind with no retry.
func TestIngestPermissionFilterConservative(t *testing.T) {
	allow := func(string, string) (bool, error) { return true, nil }
	deny := func(string, string) (bool, error) { return false, nil }
	boom := func(string, string) (bool, error) { return false, errors.New("ssar boom") }

	cases := []struct {
		name              string
		canList, canWatch func(string, string) (bool, error)
		wantRun           bool
	}{
		{"both allowed -> run", allow, allow, true},
		{"list denied -> skip", deny, allow, false},
		{"watch denied -> skip", allow, deny, false},
		{"list errors -> run (deadline backstops)", boom, allow, true},
		{"watch errors -> run (deadline backstops)", allow, boom, true},
		{"both error -> run", boom, boom, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ingestPermissionFilter(tc.canList, tc.canWatch)("g", "r")
			if got != tc.wantRun {
				t.Fatalf("ingestPermissionFilter run=%v, want %v", got, tc.wantRun)
			}
		})
	}
}
