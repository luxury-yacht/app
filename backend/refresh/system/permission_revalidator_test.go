package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

func TestPermissionRevalidationUsesRecordedNamespace(t *testing.T) {
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "team-a", nil
	})
	// Discovery-backed CRDs are intentionally absent from the static scope
	// predicate, so a generic Can call would check them cluster-wide.
	checker.SetScope([]string{"team-a"}, func(_, _ string) bool { return false })
	factory := informer.New(fake.NewClientset(), nil, 0, checker)

	require.True(t, factory.CanListWatchInNamespace("example.com", "widgets", "team-a"))

	subsystem := &Subsystem{
		RuntimePerms:    checker,
		InformerFactory: factory,
	}
	require.False(t, subsystem.permissionRevoked(context.Background()),
		"a namespace-scoped grant must not be rechecked cluster-wide")
}

func TestPermissionRevalidationPreservesDefaultScopeEvaluation(t *testing.T) {
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "team-a", nil
	})
	checker.SetScope([]string{"team-a"}, func(group, resource string) bool {
		return group == "apps" && resource == "deployments"
	})
	factory := informer.New(fake.NewClientset(), nil, 0, checker)

	require.True(t, factory.CanListWatch("apps", "deployments"))

	subsystem := &Subsystem{
		RuntimePerms:    checker,
		InformerFactory: factory,
	}
	require.False(t, subsystem.permissionRevoked(context.Background()),
		"a default permission grant must retain the checker's configured scope fan-out")
}

func TestPermissionRevalidationDetectsRevocationAtRecordedNamespace(t *testing.T) {
	initialChecker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "team-a", nil
	})
	factory := informer.New(fake.NewClientset(), nil, 0, initialChecker)
	require.True(t, factory.CanListWatchInNamespace("example.com", "widgets", "team-a"))

	var checkedNamespaces []string
	revalidationChecker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		checkedNamespaces = append(checkedNamespaces, namespace)
		return false, nil
	})
	subsystem := &Subsystem{
		RuntimePerms:    revalidationChecker,
		InformerFactory: factory,
	}

	require.True(t, subsystem.permissionRevoked(context.Background()))
	require.NotEmpty(t, checkedNamespaces)
	for _, namespace := range checkedNamespaces {
		require.Equal(t, "team-a", namespace, "revocation must be checked at the recorded informer namespace")
	}
}
