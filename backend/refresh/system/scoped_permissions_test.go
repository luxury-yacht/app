package system

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// The scope predicate encodes the rule that a permission check's scope must
// match the data source's scope: only namespaced, ingest-owned kinds are
// served from per-namespace-capable sources today. Factory-backed kinds
// (events, HPA, replicasets, gateway) and cluster-scoped kinds stay
// cluster-wide until their sources are scoped.
func TestScopedResourcePredicate(t *testing.T) {
	applies := scopedResourcePredicate()

	require.True(t, applies("apps", "deployments"))
	require.True(t, applies("", "pods"))
	require.True(t, applies("", "secrets"))
	require.False(t, applies("", "events"), "events informer is cluster-wide")
	require.False(t, applies("autoscaling", "horizontalpodautoscalers"), "HPA informer is cluster-wide")
	require.False(t, applies("apps", "replicasets"), "RS informer is cluster-wide")
	require.False(t, applies("", "nodes"), "cluster-scoped kinds never scope")
	require.False(t, applies("", "namespaces"))
	require.False(t, applies("gateway.networking.k8s.io", "httproutes"), "gateway informers are cluster-wide")
}
