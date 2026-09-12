package objectcatalog

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func TestRelatedLinksRequireUnambiguousClusterDiscovery(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "a"}, nil)
	link := resourcemodel.NewDisplayResourceLink("a", "karpenter.k8s.aws", "", "EC2NodeClass", "", "", "default")
	require.Same(t, &link, svc.ResolveRelatedResourceLink(&link), "loading discovery must leave the source readable")

	desc := builtinDescriptor("karpenter.k8s.aws", "v1beta1", "EC2NodeClass", "ec2nodeclasses", false)
	svc.identity.replaceDiscovered([]resourceDescriptor{
		desc,
		builtinDescriptor("another.provider", "v1", "EC2NodeClass", "classes", false),
	})
	resolved := svc.ResolveRelatedResourceLink(&link)
	require.NotNil(t, resolved.Ref)
	require.Nil(t, resolved.Display)
	require.Equal(t, resourcemodel.ResourceRef{ClusterID: "a", Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Name: "default"}, *resolved.Ref)
	require.Nil(t, link.Ref, "resolution must not mutate the source projection")
	require.Empty(t, svc.Snapshot(), "links do not depend on LIST permission or collected target objects")
	require.Same(t, resolved, svc.ResolveRelatedResourceLink(resolved), "explicit source identity stays authoritative")
	require.Nil(t, svc.ResolveRelatedResourceLink(nil))

	for _, display := range []resourcemodel.DisplayRef{
		{ClusterID: "b", Group: desc.Group, Kind: desc.Kind, Name: "default"},
		{ClusterID: "a", Group: "missing.provider", Kind: desc.Kind, Name: "default"},
		{ClusterID: "a", Group: desc.Group, Kind: desc.Kind, Name: "default", Namespace: "unexpected"},
		{ClusterID: "a", Group: desc.Group, Kind: desc.Kind, Name: "default", Version: "v9"},
		{ClusterID: "a", Group: desc.Group, Kind: desc.Kind, Name: "default", Resource: "wrongplural"},
		{ClusterID: "a", Group: desc.Group, Kind: desc.Kind},
		{ClusterID: "a", Kind: desc.Kind, Name: "default"},
	} {
		unresolved := &resourcemodel.ResourceLink{Display: &display}
		require.Same(t, unresolved, svc.ResolveRelatedResourceLink(unresolved), "must not guess missing or conflicting identity: %+v", display)
	}
	svc.identity.replaceDiscovered([]resourceDescriptor{desc, builtinDescriptor(desc.Group, "v1", desc.Kind, desc.Resource, false)})
	require.Same(t, &link, svc.ResolveRelatedResourceLink(&link), "multiple discovered versions must not depend on map iteration order")
	svc.identity.replaceDiscovered(nil)
	require.Same(t, &link, svc.ResolveRelatedResourceLink(&link), "CRD removal must remove discovery-based links")
}
