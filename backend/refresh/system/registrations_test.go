package system

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

// These tests guard the registration table ordering and dependency checks.

func TestDomainRegistrationOrder(t *testing.T) {
	// Keep the expected order in sync with domainRegistrations to prevent drift.
	expected := []string{
		"namespace-listing",
		"cluster-overview",
		"catalog",
		"catalog-diff",
		"nodes",
		"cluster-config",
		"cluster-crds",
		"cluster-custom",
		"cluster-events",
		"cluster-rbac",
		"cluster-storage",
		"namespace-workloads",
		"namespace-autoscaling",
		"namespace-config",
		"namespace-custom",
		"namespace-events",
		"namespace-helm",
		"namespace-network",
		"namespace-quotas",
		"namespace-rbac",
		"namespace-storage",
		"pod",
		"object-details",
		"object-yaml",
		"object-helm-manifest",
		"object-helm-values",
		"object-events",
		"node-maintenance",
	}

	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	actual := make([]string, 0, len(registrations))
	for _, registration := range registrations {
		actual = append(actual, registration.name)
	}

	require.Equal(t, expected, actual)
}

func TestDomainRegistrationRequiresDependencies(t *testing.T) {
	// Verify that dependency-gated registrations reject missing dependencies.
	missingDeps := domainRegistrations(registrationDeps{cfg: Config{}})

	custom := findRegistration(t, missingDeps, "namespace-custom")
	require.NotNil(t, custom.require)
	require.ErrorContains(t, custom.require(), "dynamic client must be provided for namespace custom resources")

	helm := findRegistration(t, missingDeps, "namespace-helm")
	require.NotNil(t, helm.require)
	require.ErrorContains(t, helm.require(), "helm factory must be provided for namespace helm domain")

	// Verify that dependency checks pass when the dependencies are provided.
	withDeps := domainRegistrations(registrationDeps{
		cfg: Config{
			DynamicClient: dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
			HelmFactory:   dummyHelmFactory,
		},
	})

	customWithDeps := findRegistration(t, withDeps, "namespace-custom")
	require.NoError(t, customWithDeps.require())

	helmWithDeps := findRegistration(t, withDeps, "namespace-helm")
	require.NoError(t, helmWithDeps.require())
}

// findRegistration locates a registration entry by name.
func findRegistration(t *testing.T, registrations []domainRegistration, name string) domainRegistration {
	t.Helper()
	for _, registration := range registrations {
		if registration.name == name {
			return registration
		}
	}
	require.FailNowf(t, "registration not found", "name=%s", name)
	return domainRegistration{}
}
