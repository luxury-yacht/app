package gatewayapi

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
)

type partialDiscovery struct {
	discovery.DiscoveryInterface
	resources []*metav1.APIResourceList
	err       error
}

func (d partialDiscovery) ServerGroupsAndResources() ([]*metav1.APIGroup, []*metav1.APIResourceList, error) {
	return nil, d.resources, d.err
}

func TestDiscoveryRetainsInstalledKindsWhenAnotherAPIGroupFails(t *testing.T) {
	failure := errors.New("unavailable API group")
	presence, err := DiscoverViaDiscovery(context.Background(), partialDiscovery{
		err: failure,
		resources: []*metav1.APIResourceList{
			nil,
			{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "gateways", Kind: "Gateway"}}},
			{GroupVersion: Group + "/v1beta1", APIResources: []metav1.APIResource{
				{Name: "httproutes", Kind: "HTTPRoute"},
				{Name: "gateways/status", Kind: "Gateway"},
				{Name: "unknowns", Kind: "Unknown"},
			}},
			{GroupVersion: Group + "/v1", APIResources: []metav1.APIResource{{Name: "httproutes", Kind: "HTTPRoute"}}},
			{GroupVersion: Group + "/", APIResources: []metav1.APIResource{{Name: "gateways", Kind: "Gateway"}}},
			{GroupVersion: Group + "/v1/invalid", APIResources: []metav1.APIResource{{Name: "gateways", Kind: "Gateway"}}},
		},
	})
	require.ErrorIs(t, err, failure)
	require.True(t, presence.AnyPresent())
	require.True(t, presence.Has(" HTTPRoute "))
	require.False(t, presence.Has("Gateway"))
	require.False(t, presence.Has("Unknown"))
	deps := common.Dependencies{GatewayClient: gatewayfake.NewSimpleClientset(), GatewayAPIPresence: presence}
	require.NoError(t, EnsureKindInstalled(deps, "HTTPRoute"))
	require.ErrorIs(t, EnsureKindInstalled(deps, "Gateway"), ErrGatewayAPINotInstalled)
	require.ErrorIs(t, EnsureKindInstalled(common.Dependencies{GatewayAPIPresence: presence}, "HTTPRoute"), ErrGatewayAPINotInstalled)
	require.NoError(t, EnsureKindInstalled(common.Dependencies{GatewayClient: deps.GatewayClient}, "HTTPRoute"))
}

func TestDiscoveryCancellationAndMissingClientDoNotAdmitGatewayKinds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	presence, err := DiscoverViaDiscovery(ctx, nil)
	require.ErrorIs(t, err, context.Canceled)
	require.False(t, presence.AnyPresent())
	presence, err = DiscoverViaDiscovery(context.Background(), nil)
	require.NoError(t, err)
	require.False(t, presence.AnyPresent())
	require.False(t, presence.Has("Gateway"))
	var absent *Presence
	require.False(t, absent.AnyPresent())
	require.False(t, absent.Has("Gateway"))
}
