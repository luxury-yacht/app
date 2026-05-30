/*
 * backend/objectcatalog/identity_contract_test.go
 *
 * Verifies the object catalog resolver is seeded from the backend-owned
 * built-in resource identity contract without local drift.
 */

package objectcatalog

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcecontract"
	"github.com/stretchr/testify/require"
)

func TestBuiltinResourceIdentityContractMatchesResolverSeed(t *testing.T) {
	require.Len(t, builtinResourceCatalog, len(resourcecontract.BuiltinResources))

	contractByKey := make(map[resourceIdentityKey]resourcecontract.BuiltinResource, len(resourcecontract.BuiltinResources))
	for _, resource := range resourcecontract.BuiltinResources {
		key := identityKey(resource.Group, resource.Version, resource.Kind)
		require.NotEmpty(t, key.version)
		require.NotEmpty(t, key.kind)
		require.NotContains(t, contractByKey, key)
		contractByKey[key] = resource
	}

	for _, desc := range builtinResourceCatalog {
		key := identityKey(desc.Group, desc.Version, desc.Kind)
		resource, ok := contractByKey[key]
		require.Truef(t, ok, "built-in resource contract missing %s/%s/%s", desc.Group, desc.Version, desc.Kind)
		require.Equal(t, desc.Resource, resource.Resource)
		require.Equal(t, desc.Namespaced, resource.Namespaced)
	}
}
