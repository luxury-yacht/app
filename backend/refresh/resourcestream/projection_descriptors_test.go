package resourcestream

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/stretchr/testify/require"
)

func TestProjectionDescriptorsStayAlignedWithSupportedDomains(t *testing.T) {
	descriptors := ProjectionDescriptors()
	require.ElementsMatch(t, SupportedDomains(), descriptorDomains(descriptors))

	permissionRequirements := domainpermissions.StreamRequirementsByDomain()
	for _, domain := range SupportedDomains() {
		descriptor := descriptors[domain]
		require.NotEmptyf(t, descriptor.ScopeKind, "domain %s must declare scope kind", domain)
		require.NotEmptyf(t, descriptor.SelectorShape, "domain %s must declare selector shape", domain)
		require.NotEmptyf(t, descriptor.RowIdentity, "domain %s must declare row identity", domain)
		require.NotEmptyf(t, descriptor.UpdateIdentity, "domain %s must declare update identity", domain)
		require.NotEmptyf(t, descriptor.Projection, "domain %s must declare projection function", domain)
		require.NotEmptyf(t, descriptor.AffectedRowResolver, "domain %s must declare affected-row resolver", domain)
		require.NotEmptyf(t, descriptor.StaleScopeResolver, "domain %s must declare stale-scope resolver", domain)
		require.Truef(t, descriptor.CompleteIsScopeLevel, "domain %s must keep COMPLETE scope-level", domain)

		require.Contains(t, permissionRequirements, domain)
		requireDescriptorCoversPermissions(t, domain, descriptor, permissionRequirements[domain])
	}
}

func descriptorDomains(descriptors map[string]ProjectionDescriptor) []string {
	domains := make([]string, 0, len(descriptors))
	for domain := range descriptors {
		domains = append(domains, domain)
	}
	return domains
}

func requireDescriptorCoversPermissions(
	t *testing.T,
	domain string,
	descriptor ProjectionDescriptor,
	requirements []permissions.ResourceRequirement,
) {
	t.Helper()
	declared := map[string]struct{}{}
	for _, resource := range descriptor.PrimaryResources {
		declared[permissions.ResourceKey(resource.Group, resource.Resource)] = struct{}{}
	}
	for _, resource := range descriptor.RelatedResources {
		declared[permissions.ResourceKey(resource.Group, resource.Resource)] = struct{}{}
	}
	for _, req := range requirements {
		require.Containsf(
			t,
			declared,
			permissions.ResourceKey(req.Group, req.Resource),
			"domain %s descriptor must declare stream permission resource %s",
			domain,
			permissions.ResourceKey(req.Group, req.Resource),
		)
	}
}
