package objectcatalog

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

type builtinIdentityContract struct {
	Resources []builtinIdentityContractResource `json:"resources"`
}

type builtinIdentityContractResource struct {
	Group      string `json:"group"`
	Version    string `json:"version"`
	Kind       string `json:"kind"`
	Resource   string `json:"resource"`
	Namespaced bool   `json:"namespaced"`
}

func TestBuiltinResourceIdentityContractMatchesResolverSeed(t *testing.T) {
	payload, err := os.ReadFile("builtin-resource-identities.json")
	require.NoError(t, err)

	var contract builtinIdentityContract
	require.NoError(t, json.Unmarshal(payload, &contract))

	require.Len(t, contract.Resources, len(builtinResourceCatalog))

	contractByKey := make(map[resourceIdentityKey]builtinIdentityContractResource, len(contract.Resources))
	for _, resource := range contract.Resources {
		key := identityKey(resource.Group, resource.Version, resource.Kind)
		require.NotEmpty(t, key.version)
		require.NotEmpty(t, key.kind)
		require.NotContains(t, contractByKey, key)
		contractByKey[key] = resource
	}

	for _, desc := range builtinResourceCatalog {
		key := identityKey(desc.Group, desc.Version, desc.Kind)
		resource, ok := contractByKey[key]
		require.Truef(t, ok, "builtin-resource-identities.json missing %s/%s/%s", desc.Group, desc.Version, desc.Kind)
		require.Equal(t, desc.Resource, resource.Resource)
		require.Equal(t, desc.Namespaced, resource.Namespaced)
	}
}
