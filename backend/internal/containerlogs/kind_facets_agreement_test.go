package containerlogs_test

import (
	"testing"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/stretchr/testify/require"
)

// A kind's container-log scope parses exactly when its descriptor declares a
// Logs target, and a node's logs (their own service) never come here: node
// scopes are cluster-scoped, which container-log scopes reject.
func TestContainerLogTargetsMatchTheLogsFacet(t *testing.T) {
	targets := kindregistry.MustLogTargets()
	for _, descriptor := range kindregistry.All {
		identity := descriptor.Identity
		scope := refresh.ObjectScopeIdentity{Namespace: "team-a", GVK: identity.GVK(), Name: "demo"}
		_, err := containerlogs.ParseTargetScope("cluster-a|"+refresh.ObjectSelector(scope).String(), targets)
		switch {
		case descriptor.Logs != nil:
			require.NoErrorf(t, err, "%s has a container Logs target the scope check rejects", identity.Kind)
			require.Truef(t, identity.Namespaced, "%s: container-log scopes are namespaced", identity.Kind)
			require.Falsef(t, descriptor.Panel.NodeLogs, "%s declares both log sources", identity.Kind)
		case descriptor.Panel.NodeLogs:
			require.Falsef(t, identity.Namespaced, "%s: node logs are for cluster-scoped nodes", identity.Kind)
		default:
			require.Errorf(t, err, "%s has no Logs target but its log scope parses", identity.Kind)
		}
	}
}
