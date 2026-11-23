package system

import (
	"context"
	"errors"
	"sync/atomic"
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
	// Exercise both direct checks and the CRD reflector's tracked grants.
	definitions := apiextensions.Identity
	kinds := []struct{ name, group, resource string }{
		{"custom resource", "g", "r"},
		{"CRD reflector", definitions.Group, definitions.Resource},
	}
	for _, kind := range kinds {
		for _, tc := range cases {
			t.Run(kind.name+": "+tc.name, func(t *testing.T) {
				checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, verb, _ string) (bool, error) {
					return tc.review(verb)
				})
				got := ingestPermissionFilter(checker, permissions.NewGrants(checker))(kind.group, kind.resource, "")
				if got != tc.wantRun {
					t.Fatalf("ingestPermissionFilter run=%v, want %v", got, tc.wantRun)
				}
			})
		}
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

// CRD admission records the decision when preflight did not complete, so
// restored access can bring back a reflector skipped for a denied list.
func TestSkippedCRDReflectorIsRevalidatedWithoutAPreflight(t *testing.T) {
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

func TestCRDReflectorAdmissionReusesPreflightGrants(t *testing.T) {
	definitions := apiextensions.Identity
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "", nil
	})
	checker.SetScope([]string{"dev", "prod"}, scopedResourcePredicate())
	grants := permissions.NewGrants(checker)
	if err := grants.Prime(t.Context(), subsystemPreflightRequests()); err != nil {
		t.Fatal(err)
	}
	if !ingestPermissionFilter(checker, grants)(definitions.Group, definitions.Resource, "") {
		t.Fatal("CRD admission must use cluster-wide permissions on a namespace-scoped cluster")
	}
	got := 0
	for grant := range grants.Snapshot() {
		group, resource, _ := grant.Identity()
		if group == definitions.Group && resource == definitions.Resource {
			got++
		}
	}
	if got != 2 {
		t.Fatalf("recorded %d CRD decisions, want one for LIST and one for WATCH", got)
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

// Scoped reflector admission checks each partition without adding reviews to
// revalidation beyond those already required by the domain's policy.
func TestScopedReflectorAdmissionDoesNotAddRevalidationReviews(t *testing.T) {
	namespaces := []string{"dev", "prod"}
	onlyDev := func(_ context.Context, _, _, _, namespace string) (bool, error) { return namespace == "dev", nil }
	checker := permissions.NewCheckerWithReview("test", time.Minute, onlyDev)
	checker.SetScope(namespaces, scopedResourcePredicate())
	grants := permissions.NewGrants(checker)
	if err := grants.Prime(t.Context(), []permissions.Request{{Resource: "configmaps", Verb: "list"}}); err != nil {
		t.Fatal(err)
	}
	filter := ingestPermissionFilter(checker, grants)
	if filter("", "configmaps", "prod") {
		t.Fatal("prod is denied: its reflector must be skipped")
	}
	if !filter("", "configmaps", "dev") {
		t.Fatal("dev is allowed: its reflector must run")
	}

	var reviews atomic.Int64
	cold := permissions.NewCheckerWithReview("test", time.Minute, func(ctx context.Context, group, resource, verb, namespace string) (bool, error) {
		reviews.Add(1)
		return onlyDev(ctx, group, resource, verb, namespace)
	})
	cold.SetScope(namespaces, scopedResourcePredicate())
	unchanged := &Subsystem{RuntimePerms: cold, PermissionGrants: grants}
	if unchanged.permissionsChanged(context.Background()) {
		t.Fatal("the same access per namespace is not a change")
	}
	if got := reviews.Load(); got != int64(len(namespaces)) {
		t.Fatalf("revalidation performed %d reviews, want the domain's %d namespace LIST reviews", got, len(namespaces))
	}
}
