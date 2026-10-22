package system

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

func TestPermissionRevalidationUsesRecordedNamespace(t *testing.T) {
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "team-a", nil
	})
	// Discovery-backed CRDs are intentionally absent from the static scope
	// predicate, so a generic Can call would check them cluster-wide.
	checker.SetScope([]string{"team-a"}, func(_, _ string) bool { return false })
	grants := permissions.NewGrants(checker)

	require.True(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", "team-a"))

	subsystem := &Subsystem{
		RuntimePerms:     checker,
		PermissionGrants: grants,
	}
	require.False(t, subsystem.permissionsChanged(context.Background()),
		"a namespace-scoped grant must not be rechecked cluster-wide")
}

func TestPermissionRevalidationPreservesDefaultScopeEvaluation(t *testing.T) {
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "team-a", nil
	})
	checker.SetScope([]string{"team-a"}, func(group, resource string) bool {
		return group == "apps" && resource == "deployments"
	})
	grants := permissions.NewGrants(checker)

	require.True(t, grants.CanListWatchWithContext(context.Background(), "apps", "deployments"))

	subsystem := &Subsystem{
		RuntimePerms:     checker,
		PermissionGrants: grants,
	}
	require.False(t, subsystem.permissionsChanged(context.Background()),
		"a default permission grant must retain the checker's configured scope fan-out")
}

func TestPermissionRevalidationDetectsRevocationAtRecordedNamespace(t *testing.T) {
	initialChecker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, _, _, _, namespace string) (bool, error) {
		return namespace == "team-a", nil
	})
	grants := permissions.NewGrants(initialChecker)
	require.True(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", "team-a"))

	var checkedNamespaces []string
	revalidationChecker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, group, resource, _, namespace string) (bool, error) {
		if group == "example.com" && resource == "widgets" {
			checkedNamespaces = append(checkedNamespaces, namespace)
		}
		return false, nil
	})
	subsystem := &Subsystem{
		RuntimePerms:     revalidationChecker,
		PermissionGrants: grants,
	}

	require.True(t, subsystem.permissionsChanged(context.Background()))
	require.NotEmpty(t, checkedNamespaces)
	for _, namespace := range checkedNamespaces {
		require.Equal(t, "team-a", namespace, "revocation must be checked at the recorded namespace")
	}
}

func TestPermissionRevalidationDetectsRestoredGrant(t *testing.T) {
	denied := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return false, nil })
	grants := permissions.NewGrants(denied)
	require.False(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", "team-a"))
	allowed := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return true, nil })
	subsystem := &Subsystem{RuntimePerms: allowed, PermissionGrants: grants}
	require.True(t, subsystem.permissionsChanged(context.Background()), "restoring a denied scope must trigger reconstruction too")
}

func TestDeniedPermissionRevalidationReviewsEachScopeOncePerCacheWindow(t *testing.T) {
	denied := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return false, nil })
	grants := permissions.NewGrants(denied)
	const namespaces = 100
	for range 5 {
		for i := range namespaces {
			require.False(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", fmt.Sprintf("team-%d", i)))
		}
	}
	for window := range 2 {
		reviews := 0
		// A fresh checker models an empty/expired cache without timing a TTL.
		checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(_ context.Context, group, resource, verb, namespace string) (bool, error) {
			if group == "example.com" && resource == "widgets" {
				reviews++
				require.Equal(t, "list", verb, "a denied LIST must not introduce a WATCH review")
				require.NotEmpty(t, namespace)
			}
			return false, nil
		})
		subsystem := &Subsystem{RuntimePerms: checker, PermissionGrants: grants}
		require.False(t, subsystem.permissionsChanged(context.Background()))
		require.Equal(t, namespaces, reviews)
		require.False(t, subsystem.permissionsChanged(context.Background()))
		require.Equal(t, namespaces, reviews, "repeated decisions must reuse the permission cache")
		t.Logf("window %d: %d denied namespaces, %d reviews across two revalidation passes", window+1, namespaces, reviews)
	}
}

type fakeFeedHub struct {
	synced bool
}

func (h fakeFeedHub) Start(context.Context) error { return nil }

func (h fakeFeedHub) HasSynced(context.Context) bool { return h.synced }

func (h fakeFeedHub) ResourcesSettled([]string) bool { return h.synced }

func (fakeFeedHub) Shutdown() error { return nil }

type permissionRevalidationHub struct {
	fakeFeedHub
	stopped chan struct{}
}

func (h *permissionRevalidationHub) Shutdown() error { close(h.stopped); return nil }

func TestPermissionChangesDelegateReplacementBeforeStoppingProducers(t *testing.T) {
	allowed := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return true, nil })
	grants := permissions.NewGrants(allowed)
	require.True(t, grants.CanListWatchWithContext(context.Background(), "", "pods"))
	denied := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string, string) (bool, error) { return false, nil })
	hub := &permissionRevalidationHub{stopped: make(chan struct{})}
	manager := refresh.NewManager(nil, hub, nil, nil, nil)
	require.NoError(t, manager.Start(context.Background()))
	defer manager.Shutdown(context.Background())
	s := &Subsystem{RuntimePerms: denied, PermissionGrants: grants, Manager: manager}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notified := make(chan struct{}, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.runPermissionRevalidation(ctx, time.Millisecond, func(context.Context) {
			select {
			case notified <- struct{}{}:
			default:
			}
		})
	}()
	select {
	case <-notified:
	case <-time.After(time.Second):
		t.Fatal("owner was not notified")
	}
	cancel()
	<-done
	select {
	case <-hub.stopped:
		t.Fatal("producers stopped before the owner could publish replacement routing")
	default:
	}
}
