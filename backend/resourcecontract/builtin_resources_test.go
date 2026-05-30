/*
 * backend/resourcecontract/builtin_resources_test.go
 *
 * Verifies the built-in Kubernetes resource identity contract is unique and
 * exposes exact GVK/GVR lookups.
 */

package resourcecontract

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuiltinResourcesAreUniqueAndComplete(t *testing.T) {
	seen := make(map[string]BuiltinResource)

	for _, resource := range BuiltinResources {
		require.NotEmpty(t, resource.Version)
		require.NotEmpty(t, resource.Kind)
		require.NotEmpty(t, resource.Resource)

		key := resourceKey(resource.Group, resource.Version, resource.Kind)
		require.NotContains(t, seen, key)
		seen[key] = resource
	}
}

func TestMustBuiltinFindsExactResourceIdentity(t *testing.T) {
	pod := MustBuiltin("", "v1", "Pod")
	require.Equal(t, "pods", pod.Resource)
	require.True(t, pod.Namespaced)
	require.Equal(t, "Pod", pod.GVK().Kind)
	require.Equal(t, "pods", pod.GVR().Resource)

	hpaV2 := MustBuiltin("autoscaling", "v2", "HorizontalPodAutoscaler")
	require.Equal(t, "autoscaling", hpaV2.Group)
	require.Equal(t, "v2", hpaV2.Version)
}

func TestBuiltinResourceJSONContractMatchesGoTable(t *testing.T) {
	contents, err := os.ReadFile("builtin-resource-identities.json")
	require.NoError(t, err)

	var contract struct {
		Resources []BuiltinResource `json:"resources"`
	}
	require.NoError(t, json.Unmarshal(contents, &contract))
	require.Equal(t, BuiltinResources, contract.Resources)
}
