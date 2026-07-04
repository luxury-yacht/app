// Package domainpermissions tests the shared refresh-domain composition table.
package domainpermissions

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// The cluster overview must stay useful for identities without node access
// (issue #244): the runtime policy allows the domain when ANY of its primary
// resources is readable, and the per-resource decisions flow to the builder
// so it can mark the denied sources instead of failing the whole domain.
func TestClusterOverviewRuntimePolicyAllowsAnyPrimaryResource(t *testing.T) {
	policy, ok := RuntimePoliciesByDomain()["cluster-overview"]
	require.True(t, ok, "cluster-overview must have a runtime policy")
	require.Equal(t, ModeAny, policy.Mode,
		"cluster overview must serve when any primary resource is readable, not require nodes")

	keys := make([]string, 0, len(policy.Runtime))
	for _, req := range policy.Runtime {
		keys = append(keys, permissions.ResourceKey(req.Group, req.Resource))
	}
	require.ElementsMatch(t, []string{"core/nodes", "core/pods", "core/namespaces"}, keys)
	require.NotEmpty(t, policy.Reason, "ModeAny denial needs an explicit human-readable reason")
}

func TestStreamDomainsDeriveFromCompositions(t *testing.T) {
	compositions := CompositionByDomain()

	for _, domain := range StreamDomains() {
		composition, ok := compositions[domain]
		require.Truef(t, ok, "stream domain %s must have a composition", domain)
		require.NotEmptyf(t, composition.Stream, "stream domain %s must declare stream resources", domain)
	}

	for _, composition := range compositions {
		if len(composition.Stream) == 0 {
			require.NotContains(t, StreamDomains(), composition.Domain)
		}
	}
}

func TestCompositionsReturnDefensiveCopies(t *testing.T) {
	compositions := Compositions()
	require.NotEmpty(t, compositions)

	compositions[0].Domain = "mutated"
	compositions[0].Runtime = append(compositions[0].Runtime, Resource{Resource: "mutated"})
	if len(compositions[0].Stream) > 0 {
		compositions[0].Stream[0].Resource = "mutated"
	}

	next := Compositions()
	require.NotEqual(t, "mutated", next[0].Domain)
	require.NotContains(t, next[0].Runtime, Resource{Resource: "mutated"})
	if len(next[0].Stream) > 0 {
		require.NotEqual(t, "mutated", next[0].Stream[0].Resource)
	}
}
