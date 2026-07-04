package system

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// permissionGateFixture wires a gate against a fake clientset whose SSAR
// responses are controlled per "resource/verb" key: entries in errOn fail the
// review, entries in allow grant it, everything else is denied.
func permissionGateFixture(t *testing.T, allow map[string]bool, errOn map[string]bool) (*permissionGate, *domain.Registry) {
	t.Helper()

	client := kubernetesfake.NewClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		create, ok := action.(cgotesting.CreateAction)
		require.True(t, ok)
		review, ok := create.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		require.True(t, ok)
		attrs := review.Spec.ResourceAttributes
		require.NotNil(t, attrs)
		key := attrs.Resource + "/" + attrs.Verb
		if errOn[key] {
			return true, nil, errors.New("ssar unavailable")
		}
		review = review.DeepCopy()
		review.Status.Allowed = allow[key]
		return true, review, nil
	})

	checker := permissions.NewChecker(client, "test-cluster", time.Minute)
	factory := informer.New(client, nil, 0, checker)
	registry := domain.New()
	gate := newPermissionGate(registry, factory,
		func(domain, resource string, errs ...error) {},
		func(domain, group, resource string) {})
	return gate, registry
}

// A ModeAny domain's list fallback must register when ANY fallback resource is
// list-allowed, so an identity with only one readable primary resource still
// gets a (partial) snapshot instead of a permission-denied placeholder.
func TestRegisterListWatchDomainFallbackAllowAnyRegistersOnSingleAllowedResource(t *testing.T) {
	gate, registry := permissionGateFixture(t,
		map[string]bool{"pods/list": true},
		nil,
	)

	informerRegistered := false
	fallbackRegistered := false
	err := gate.registerListWatchDomain(listWatchDomainConfig{
		name:   "test-overview",
		checks: []listWatchCheck{{group: "", resource: "namespaces"}},
		registerInformer: func() error {
			informerRegistered = true
			return nil
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
			{group: "", resource: "namespaces"},
		},
		fallbackAllowAny: true,
		registerFallback: func() error {
			fallbackRegistered = true
			return nil
		},
		deniedReason: "test denied",
	})

	require.NoError(t, err)
	require.False(t, informerRegistered)
	require.True(t, fallbackRegistered, "one allowed fallback resource must be enough with fallbackAllowAny")
	require.False(t, registry.IsPermissionDenied("test-overview"))
}

// An SSAR error on one fallback resource must not disqualify the others under
// fallbackAllowAny: each resource qualifies (or not) on its own checks.
func TestRegisterListWatchDomainFallbackAllowAnyToleratesOtherResourceErrors(t *testing.T) {
	gate, registry := permissionGateFixture(t,
		map[string]bool{"pods/list": true},
		map[string]bool{"nodes/list": true, "nodes/watch": true},
	)

	fallbackRegistered := false
	err := gate.registerListWatchDomain(listWatchDomainConfig{
		name:   "test-overview",
		checks: []listWatchCheck{{group: "", resource: "namespaces"}},
		registerInformer: func() error {
			return nil
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
		},
		fallbackAllowAny: true,
		registerFallback: func() error {
			fallbackRegistered = true
			return nil
		},
		deniedReason: "test denied",
	})

	require.NoError(t, err)
	require.True(t, fallbackRegistered, "pods qualifies on its own despite the nodes SSAR error")
	require.False(t, registry.IsPermissionDenied("test-overview"))
}

// With no fallback resource allowed the domain still lands on the
// permission-denied placeholder.
func TestRegisterListWatchDomainFallbackAllowAnyDeniesWhenNothingAllowed(t *testing.T) {
	gate, registry := permissionGateFixture(t, nil, nil)

	fallbackRegistered := false
	err := gate.registerListWatchDomain(listWatchDomainConfig{
		name:   "test-overview",
		checks: []listWatchCheck{{group: "", resource: "namespaces"}},
		registerInformer: func() error {
			return nil
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
			{group: "", resource: "namespaces"},
		},
		fallbackAllowAny: true,
		registerFallback: func() error {
			fallbackRegistered = true
			return nil
		},
		deniedReason: "test denied",
	})

	require.NoError(t, err)
	require.False(t, fallbackRegistered)
	require.True(t, registry.IsPermissionDenied("test-overview"))
}

// The default (all-of) fallback semantics are unchanged: a partially allowed
// fallback set stays denied without fallbackAllowAny.
func TestRegisterListWatchDomainFallbackDefaultStillRequiresAllResources(t *testing.T) {
	gate, registry := permissionGateFixture(t,
		map[string]bool{"pods/list": true},
		nil,
	)

	fallbackRegistered := false
	err := gate.registerListWatchDomain(listWatchDomainConfig{
		name:   "test-nodes",
		checks: []listWatchCheck{{group: "", resource: "nodes"}, {group: "", resource: "pods"}},
		registerInformer: func() error {
			return nil
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
		},
		registerFallback: func() error {
			fallbackRegistered = true
			return nil
		},
		deniedReason: "test denied",
	})

	require.NoError(t, err)
	require.False(t, fallbackRegistered)
	require.True(t, registry.IsPermissionDenied("test-nodes"))
}
