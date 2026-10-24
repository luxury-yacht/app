package domainpermissions

import (
	"context"
	"errors"
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

func TestRuntimeAccessKeepsOptionalAttentionSourcesWhenAllAreDenied(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(context.Context, string, string, string, string) (bool, error) {
		return false, nil
	})

	decision, err := access.Check(context.Background(), "cluster-attention", checker)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.NotEmpty(t, decision.AllowedResources)
	for _, allowed := range decision.AllowedResources {
		require.False(t, allowed)
	}
}

// The namespace-helm domain reads Helm releases from the Secrets ingest
// partitions, so under a namespace scope a per-namespace secrets grant
// registers it, exactly like namespace-config (docs/architecture/namespace-scope.md).
func TestRuntimeAccessHelmPolicyFollowsTheNamespaceScope(t *testing.T) {
	access := NewRuntimeAccess()
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		// Allowed per-namespace, denied cluster-wide.
		return namespace != "", nil
	})
	checker.SetScope([]string{"prod"}, func(_, resource string) bool {
		return resource == "secrets" || resource == "configmaps"
	})

	for _, domainName := range []string{"namespace-helm", "namespace-config"} {
		decision, err := access.Check(context.Background(), domainName, checker)
		require.NoError(t, err)
		require.True(t, decision.Allowed, "%s must register on per-namespace grants", domainName)
	}
}

// The Nodes table joins each node's pods for its pod counts. Its policy checks
// pods on every request without requiring them: readable pods are reported
// allowed, and denied or unevaluable pods are reported not allowed while the
// Nodes view still loads.
func TestRuntimeAccessChecksNodePodsWithoutRequiringThem(t *testing.T) {
	access := NewRuntimeAccess()
	for _, tc := range []struct {
		name     string
		pods     func() (bool, error)
		wantPods bool
	}{
		{name: "pods readable", pods: func() (bool, error) { return true, nil }, wantPods: true},
		{name: "pods denied", pods: func() (bool, error) { return false, nil }, wantPods: false},
		{name: "pods check failed", pods: func() (bool, error) { return false, errors.New("review failed") }, wantPods: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			checker := permissions.NewCheckerWithReview("cluster-a", 0, func(_ context.Context, _, resource, _, _ string) (bool, error) {
				if resource == "pods" {
					return tc.pods()
				}
				return true, nil
			})

			decision, err := access.Check(context.Background(), "nodes", checker)
			require.NoError(t, err)
			require.True(t, decision.Allowed)
			require.Equal(t, AllowedResources{
				permissions.ResourceKey("", "nodes"): true,
				permissions.ResourceKey("", "pods"):  tc.wantPods,
			}, decision.AllowedResources)
		})
	}
}
