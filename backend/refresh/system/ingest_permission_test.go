package system

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// TestIngestPermissionFilterConservative pins the conservative gating contract: the
// ingest reflector for a kind is skipped ONLY on a confirmed denial (allowed==false with
// no error). On an SSAR error the filter returns true so the reflector still runs — the
// per-kind sync-deadline degrade is the backstop, so a transient permission blip never
// wrongly excludes a kind with no retry.
func TestIngestPermissionFilterConservative(t *testing.T) {
	cases := []struct {
		name    string
		review  func(verb string) (bool, error)
		wantRun bool
	}{
		{"both allowed -> run", func(string) (bool, error) { return true, nil }, true},
		{"list denied -> skip", func(verb string) (bool, error) { return verb != "list", nil }, false},
		{"watch denied -> skip", func(verb string) (bool, error) { return verb != "watch", nil }, false},
		{"list errors -> run (deadline backstops)", func(verb string) (bool, error) {
			if verb == "list" {
				return false, errors.New("ssar boom")
			}
			return true, nil
		}, true},
		{"both error -> run", func(string) (bool, error) { return false, errors.New("ssar boom") }, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, verb, _ string) (bool, error) {
				return tc.review(verb)
			})
			got := ingestPermissionFilter(checker)("g", "r", "")
			if got != tc.wantRun {
				t.Fatalf("ingestPermissionFilter run=%v, want %v", got, tc.wantRun)
			}
		})
	}
}

// TestIngestPermissionFilterChecksThePartNamespace pins the scoped contract
// (docs/plans/namespace-scope.md): a part's filter decision is made for ITS
// namespace, so one denied namespace skips one reflector — never the kind.
func TestIngestPermissionFilterChecksThePartNamespace(t *testing.T) {
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace != "prod", nil
	})
	filter := ingestPermissionFilter(checker)

	if filter("g", "r", "prod") {
		t.Fatal("prod is denied: its part must be skipped")
	}
	if !filter("g", "r", "dev") {
		t.Fatal("dev is allowed: its part must run")
	}
	if !filter("g", "r", "") {
		t.Fatal("cluster-wide part uses the cluster-wide check")
	}
}
