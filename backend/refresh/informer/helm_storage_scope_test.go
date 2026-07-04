package informer

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// The helm-storage factory LISTs/WATCHes secrets+configmaps cluster-wide, so
// its gate must be the cluster-wide check even under a namespace scope
// (docs/plans/namespace-scope.md): per-namespace grants must not create
// informers that would only 403.
func TestHelmStorageGateIsClusterWideUnderNamespaceScope(t *testing.T) {
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		// Allowed in configured namespaces, denied cluster-wide.
		return namespace != "", nil
	})
	checker.SetScope([]string{"prod"}, func(_, resource string) bool {
		return resource == "secrets" || resource == "configmaps"
	})

	factory := New(fake.NewSimpleClientset(), nil, time.Minute, checker)
	helm := factory.HelmStorage()
	require.NotNil(t, helm)
	require.Nil(t, helm.SecretInformer(), "per-namespace grant must not create the cluster-wide helm secret informer")
	require.Nil(t, helm.ConfigMapInformer(), "per-namespace grant must not create the cluster-wide helm configmap informer")
}
