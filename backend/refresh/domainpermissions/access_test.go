package domainpermissions

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/stretchr/testify/require"
)

func TestRuntimeAccessAllowsUnknownDomain(t *testing.T) {
	access := NewRuntimeAccess()
	require.False(t, access.IsEmpty())
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		t.Fatalf("unexpected permission review for unknown domain")
		return false, nil
	})

	decision, err := access.Check(context.Background(), "unknown", checker)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.Empty(t, decision.DeniedReason)
}

func TestRuntimeAccessZeroValueIsEmpty(t *testing.T) {
	var access RuntimeAccess
	require.True(t, access.IsEmpty())
}

func TestRuntimeAccessDeniedReason(t *testing.T) {
	access := NewRuntimeAccess()

	reason, ok := access.DeniedReason("namespace-config")
	require.True(t, ok)
	require.Equal(t, "core/configmaps,secrets", reason)

	_, ok = access.DeniedReason("unknown")
	require.False(t, ok)
}

func TestRuntimeAccessRequiresAllPolicyRequirements(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return !(group == "" && resource == "namespaces" && verb == "list"), nil
	})

	decision, err := access.Check(context.Background(), "namespaces", checker)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, "core/namespaces", decision.DeniedReason)
}

func TestRuntimeAccessAllowsAnyPolicyRequirement(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return resource == "secrets" && verb == "list", nil
	})

	decision, err := access.Check(context.Background(), "namespace-config", checker)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
}

func TestRuntimeAccessDeniesAnyPolicyWhenNoRequirementsAllowed(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return false, nil
	})

	decision, err := access.Check(context.Background(), "namespace-config", checker)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, "core/configmaps,secrets", decision.DeniedReason)
}

// The namespace-helm domain reads from the CLUSTER-WIDE helm-storage factory,
// so its runtime policy must stay a cluster-wide check under a namespace
// scope (docs/plans/namespace-scope.md): a per-namespace secrets grant must
// not register a domain whose source can only 403.
func TestRuntimeAccessHelmPolicyStaysClusterWideUnderScope(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		// Allowed per-namespace, denied cluster-wide.
		return namespace != "", nil
	})
	checker.SetScope([]string{"prod"}, func(_, resource string) bool {
		return resource == "secrets" || resource == "configmaps"
	})

	decision, err := access.Check(context.Background(), "namespace-helm", checker)
	require.NoError(t, err)
	require.False(t, decision.Allowed, "cluster-wide helm source denied ⇒ domain denied, even with per-namespace grants")

	// A domain whose source IS scoped (ingest-owned kinds) registers on the
	// strength of the per-namespace grant.
	decision, err = access.Check(context.Background(), "namespace-config", checker)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
}
