package system

import (
	"encoding/json"
	"os"
	"path/filepath"
	goruntime "runtime"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

// These tests guard the registration table ordering and dependency checks.

type refreshDomainManifest struct {
	Version int                   `json:"version"`
	Domains []refreshDomainRecord `json:"domains"`
}

type refreshDomainRecord struct {
	Domain  string `json:"domain"`
	Backend struct {
		Registration   string `json:"registration"`
		Permission     string `json:"permission"`
		ResourceStream bool   `json:"resourceStream"`
	} `json:"backend"`
}

func TestDomainRegistrationOrder(t *testing.T) {
	expected := manifestSnapshotDomains(t)

	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	actual := make([]string, 0, len(registrations))
	for _, registration := range registrations {
		actual = append(actual, registration.name)
	}

	require.Equal(t, expected, actual)
}

func TestDomainRegistrationsMatchManifestContract(t *testing.T) {
	manifest := loadRefreshDomainManifest(t)
	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	registered := make(map[string]domainRegistration, len(registrations))
	for _, registration := range registrations {
		registered[registration.name] = registration
	}

	manifestDomains := make(map[string]struct{}, len(manifest.Domains))
	for _, domain := range manifest.Domains {
		require.NotEmpty(t, domain.Domain)
		require.NotContains(t, manifestDomains, domain.Domain)
		manifestDomains[domain.Domain] = struct{}{}

		if domain.Backend.Registration == "streamOnly" {
			require.NotContains(t, registered, domain.Domain)
			continue
		}

		registration, ok := registered[domain.Domain]
		require.Truef(t, ok, "domain %q is missing backend registration", domain.Domain)
		require.Equalf(t, domain.Backend.Registration, registrationKind(registration), "domain %q registration kind drifted", domain.Domain)
	}

	for _, registration := range registrations {
		require.Containsf(t, manifestDomains, registration.name, "backend domain %q is missing from refresh-domain-manifest.json", registration.name)
	}
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
	runtimePolicies := snapshot.RuntimePermissionRequirements()
	for _, domain := range loadRefreshDomainManifest(t).Domains {
		switch domain.Backend.Permission {
		case "runtime":
			require.Containsf(t, runtimePolicies, domain.Domain, "domain %q must have a runtime permission policy", domain.Domain)
		case "exempt":
			require.NotContainsf(t, runtimePolicies, domain.Domain, "domain %q is manifest-exempt and should not have a broad runtime policy", domain.Domain)
		case "stream-specific":
			require.Equal(t, "streamOnly", domain.Backend.Registration)
		default:
			require.Failf(t, "unknown permission contract", "domain=%s permission=%s", domain.Domain, domain.Backend.Permission)
		}
	}
}

func TestResourceStreamDomainsMatchManifestContract(t *testing.T) {
	manifestDomains := manifestResourceStreamDomains(t)
	require.ElementsMatch(t, manifestDomains, resourcestream.SupportedDomains())

	streamRequirements := resourcestream.PermissionRequirementsByDomain()
	for _, domainName := range manifestDomains {
		require.Containsf(t, streamRequirements, domainName, "resource stream domain %q must declare permission requirements", domainName)
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

func loadRefreshDomainManifest(t *testing.T) refreshDomainManifest {
	t.Helper()
	_, filename, _, ok := goruntime.Caller(0)
	require.True(t, ok)
	manifestPath := filepath.Join(filepath.Dir(filename), "testdata/refresh-domain-manifest.json")
	data, err := os.ReadFile(manifestPath)
	require.NoError(t, err)

	var manifest refreshDomainManifest
	require.NoError(t, json.Unmarshal(data, &manifest))
	require.Equal(t, 1, manifest.Version)
	require.NotEmpty(t, manifest.Domains)
	return manifest
}

func manifestSnapshotDomains(t *testing.T) []string {
	t.Helper()
	manifest := loadRefreshDomainManifest(t)
	result := make([]string, 0, len(manifest.Domains))
	for _, domain := range manifest.Domains {
		if domain.Backend.Registration != "streamOnly" {
			result = append(result, domain.Domain)
		}
	}
	return result
}

func manifestResourceStreamDomains(t *testing.T) []string {
	t.Helper()
	manifest := loadRefreshDomainManifest(t)
	result := make([]string, 0, len(manifest.Domains))
	for _, domain := range manifest.Domains {
		if domain.Backend.ResourceStream {
			result = append(result, domain.Domain)
		}
	}
	return result
}

func registrationKind(registration domainRegistration) string {
	switch {
	case registration.direct != nil:
		return "direct"
	case registration.list != nil:
		return "list"
	case registration.listWatch != nil:
		return "listWatch"
	default:
		return ""
	}
}
