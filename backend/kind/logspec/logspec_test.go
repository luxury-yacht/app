package logspec

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Fetch keeps a scope's kind as written (Deployment) and the stream lowercases
// it (deployment), so every read goes through one key: exact group and version,
// kind in any case.
func TestTargetsLookupMatchesGroupAndVersionExactlyAndKindInAnyCase(t *testing.T) {
	targets, err := NewTargets(map[schema.GroupVersionKind]Target{
		{Group: "apps", Version: "v1", Kind: "Deployment"}: {},
	})
	require.NoError(t, err)

	for _, kind := range []string{"Deployment", "deployment", " deployment "} {
		_, ok := targets.Lookup(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: kind})
		require.Truef(t, ok, "kind %q", kind)
	}
	_, ok := targets.Lookup(schema.GroupVersionKind{Group: "apps", Version: "v1beta1", Kind: "Deployment"})
	require.False(t, ok, "another version is not a target")
	_, ok = targets.Lookup(schema.GroupVersionKind{Group: "batch", Version: "v1", Kind: "Deployment"})
	require.False(t, ok, "another group is not a target")
}

func TestNewTargetsRejectsEntriesThatShareAKey(t *testing.T) {
	_, err := NewTargets(map[schema.GroupVersionKind]Target{
		{Group: "apps", Version: "v1", Kind: "Deployment"}: {},
		{Group: "apps", Version: "v1", Kind: "deployment"}: {},
	})
	require.Error(t, err)
}

func TestEmptyTargetsHaveNoEntries(t *testing.T) {
	var targets Targets
	require.Zero(t, targets.Len())
	_, ok := targets.Lookup(schema.GroupVersionKind{Version: "v1", Kind: "Pod"})
	require.False(t, ok)
}
