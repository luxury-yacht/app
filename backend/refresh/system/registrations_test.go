package system

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

// These tests guard the registration table ordering and dependency checks.

func TestDomainRegistrationOrder(t *testing.T) {
	// Keep the expected order in sync with domainRegistrations to prevent drift.
	expected := []string{
		"namespaces",
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
		"pods",
		"object-details",
		"object-yaml",
		"object-helm-manifest",
		"object-helm-values",
		"object-events",
		"object-map",
		"object-maintenance",
	}

	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	actual := make([]string, 0, len(registrations))
	for _, registration := range registrations {
		actual = append(actual, registration.name)
	}

	require.Equal(t, expected, actual)
}

func TestResourceStreamDomainsAreRegisteredRefreshDomains(t *testing.T) {
	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	registered := make(map[string]struct{}, len(registrations))
	for _, registration := range registrations {
		registered[registration.name] = struct{}{}
	}

	for _, domainName := range resourcestream.SupportedDomains() {
		require.Contains(t, registered, domainName)
	}
}

func TestDomainRegistrationsHaveRuntimePermissionPolicyOrExemption(t *testing.T) {
	exemptions := map[string]string{
		"catalog":              "catalog rows come from the object catalog service",
		"catalog-diff":         "catalog diff rows come from the object catalog service",
		"object-details":       "object details are checked by the detail provider and action paths",
		"object-yaml":          "YAML read/edit capability checks are object-specific",
		"object-helm-manifest": "Helm content checks are object-specific",
		"object-helm-values":   "Helm content checks are object-specific",
		"object-maintenance":   "node maintenance domain exposes app-managed operation state",
	}

	runtimePolicies := snapshot.RuntimePermissionRequirements()
	for _, registration := range domainRegistrations(registrationDeps{cfg: Config{}}) {
		if _, ok := runtimePolicies[registration.name]; ok {
			continue
		}
		reason, ok := exemptions[registration.name]
		require.Truef(t, ok, "domain %q must have a runtime permission policy or exemption", registration.name)
		require.NotEmpty(t, reason)
	}
}

func TestResourceStreamPermissionRequirementsStayAlignedWithSnapshotRuntime(t *testing.T) {
	streamRequirements := resourcestream.PermissionRequirementsByDomain()
	snapshotRequirements := snapshot.RuntimePermissionRequirements()

	for _, domainName := range resourcestream.SupportedDomains() {
		streamReqs, ok := streamRequirements[domainName]
		require.Truef(t, ok, "stream domain %q is missing a permission requirement contract", domainName)
		snapshotReq, ok := snapshotRequirements[domainName]
		require.Truef(t, ok, "stream domain %q is missing a snapshot runtime permission contract", domainName)

		streamKeys := requirementKeys(streamReqs)
		for _, req := range snapshotReq.Requirements {
			require.Containsf(
				t,
				streamKeys,
				permissions.ResourceKey(req.Group, req.Resource),
				"stream domain %q must include snapshot resource %s",
				domainName,
				permissions.ResourceKey(req.Group, req.Resource),
			)
		}
	}
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

func requirementKeys(reqs []permissions.ResourceRequirement) map[string]struct{} {
	keys := make(map[string]struct{}, len(reqs))
	for _, req := range reqs {
		keys[permissions.ResourceKey(req.Group, req.Resource)] = struct{}{}
	}
	return keys
}
