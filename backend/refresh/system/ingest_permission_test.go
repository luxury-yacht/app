package system

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
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
			got := ingestPermissionFilter(checker, permissions.NewGrants(checker))("g", "r", "")
			if got != tc.wantRun {
				t.Fatalf("ingestPermissionFilter run=%v, want %v", got, tc.wantRun)
			}
		})
	}
}

// TestIngestPermissionFilterChecksThePartNamespace pins the scoped contract
// (docs/architecture/namespace-scope.md): a part's filter decision is made for ITS
// namespace, so one denied namespace skips one reflector — never the kind.
func TestIngestPermissionFilterChecksThePartNamespace(t *testing.T) {
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace != "prod", nil
	})
	filter := ingestPermissionFilter(checker, permissions.NewGrants(checker))

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

// A built-in kind's reflector is admitted once per generation. Its decision
// must be the one permission revalidation rechecks, even when the connect-time
// preflight never reached the kind (it timed out): a reflector skipped for a
// denied list has to come back when access is restored.
func TestSkippedBuiltInReflectorIsRevalidatedWithoutAPreflight(t *testing.T) {
	denied := permissions.NewCheckerWithReview("test", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return false, nil })
	grants := permissions.NewGrants(denied)
	definitions := apiextensions.Identity

	if ingestPermissionFilter(denied, grants)(definitions.Group, definitions.Resource, "") {
		t.Fatal("a denied list must skip the reflector")
	}

	allowed := permissions.NewCheckerWithReview("test", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return true, nil })
	subsystem := &Subsystem{RuntimePerms: allowed, PermissionGrants: grants}
	if !subsystem.permissionsChanged(context.Background()) {
		t.Fatal("restored access to a skipped reflector's kind must request a rebuild")
	}
}

// A custom resource's source is admitted again on every discovery, so its
// checks are not held for revalidation: a cluster with hundreds of custom
// resources must not add hundreds of reviews to each revalidation pass, or
// rebuild the generation when one custom resource's access changes.
func TestCustomResourceAdmissionIsNotHeldForRevalidation(t *testing.T) {
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return true, nil })
	grants := permissions.NewGrants(checker)

	if !ingestPermissionFilter(checker, grants)("example.com", "widgets", "") {
		t.Fatal("an allowed custom resource must be admitted")
	}
	if recorded := grants.Snapshot(); len(recorded) != 0 {
		t.Fatalf("custom resource checks must not be recorded, got %d", len(recorded))
	}
}
