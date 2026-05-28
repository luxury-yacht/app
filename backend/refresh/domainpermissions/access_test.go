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
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
		return !(group == "" && resource == "namespaces" && verb == "list"), nil
	})

	decision, err := access.Check(context.Background(), "namespaces", checker)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, "core/namespaces", decision.DeniedReason)
}

func TestRuntimeAccessAllowsAnyPolicyRequirement(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
		return resource == "secrets" && verb == "list", nil
	})

	decision, err := access.Check(context.Background(), "namespace-config", checker)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
}

func TestRuntimeAccessDeniesAnyPolicyWhenNoRequirementsAllowed(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
		return false, nil
	})

	decision, err := access.Check(context.Background(), "namespace-config", checker)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, "core/configmaps,secrets", decision.DeniedReason)
}
