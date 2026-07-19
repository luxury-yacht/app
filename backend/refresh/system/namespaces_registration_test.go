package system

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Scoped clusters (docs/plans/namespace-scope.md) register the namespaces
// domain directly: rows are synthesized from configuration, so neither the
// cluster-wide list+watch gate nor the runtime policy may apply — both would
// deny exactly the restricted user the scope exists for.
func TestNamespacesRegistrationScopedBypassesPermissionGates(t *testing.T) {
	deps := registrationDeps{cfg: Config{AllowedNamespaces: []string{"prod", "dev"}}}

	reg := namespacesRegistration(deps)
	require.Equal(t, "namespaces", reg.name)
	require.NotNil(t, reg.direct, "scoped registration must dispatch directly")
	require.Nil(t, reg.listWatch)
	require.True(t, reg.skipRuntimePolicy, "synthesized rows need no cluster permission")
}

func TestNamespacesRegistrationUnscopedKeepsFailFastGate(t *testing.T) {
	deps := registrationDeps{cfg: Config{}}

	reg := namespacesRegistration(deps)
	require.Equal(t, "namespaces", reg.name)
	require.Nil(t, reg.direct)
	require.NotNil(t, reg.listWatch)
	require.False(t, reg.skipRuntimePolicy)
	require.Equal(t, []listWatchCheck{{group: "", resource: "namespaces"}}, reg.listWatch.checks)
}

func TestNamespaceMetricsRegistrationIsIndependentFromNamespaceObjectPermissions(t *testing.T) {
	registrations := domainRegistrations(registrationDeps{cfg: Config{ClusterID: "cluster-a"}})

	var metricRegistration *domainRegistration
	for i := range registrations {
		if registrations[i].name == "namespace-metrics" {
			metricRegistration = &registrations[i]
			break
		}
	}

	require.NotNil(t, metricRegistration)
	require.NotNil(t, metricRegistration.direct)
	require.True(t, metricRegistration.skipRuntimePolicy)
}
