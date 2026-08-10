package resourcemodel

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type HelmManifestResourceIdentity struct {
	Group     string
	Version   string
	Kind      string
	Resource  string
	Namespace string
	Name      string
	Scope     ResourceScope
	Openable  bool
}

type HelmManifestResource struct {
	APIVersion        string
	Kind              string
	Namespace         string
	Name              string
	NamespaceExplicit bool
}

func BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(ctx context.Context, resolver common.ResourceResolver, clusterID string, resource HelmManifestResource) ResourceLink {
	identity := ResolveHelmManifestResourceIdentityWithResolver(ctx, resolver, resource.APIVersion, resource.Kind, resource.Namespace, resource.Name, resource.NamespaceExplicit)
	if !identity.Openable {
		return displayResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name)
	}
	if identity.Scope == ResourceScopeCluster {
		return ClusterResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Name, "")
	}
	return NewNamespacedResourceLink(ResourceRef{ClusterID: clusterID, Group: identity.Group, Version: identity.Version, Kind: identity.Kind, Resource: identity.Resource, Namespace: identity.Namespace, Name: identity.Name, UID: ""})
}

func ResolveHelmManifestResourceIdentityWithResolver(ctx context.Context, resolver common.ResourceResolver, apiVersion, kind, namespace, name string, namespaceExplicit bool) HelmManifestResourceIdentity {
	if ctx == nil {
		ctx = context.Background()
	}
	group, version := SplitAPIVersion(strings.TrimSpace(apiVersion))
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	identity := HelmManifestResourceIdentity{
		Group:     group,
		Version:   version,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
	}
	if kind == "" || name == "" || version == "" {
		return identity
	}
	if resolver != nil {
		resolved, ok, err := resolver.ResolveResourceForGVK(ctx, schema.GroupVersionKind{
			Group:   group,
			Version: version,
			Kind:    kind,
		})
		if err == nil && ok {
			identity.Group = resolved.Group
			identity.Version = resolved.Version
			identity.Kind = resolved.Kind
			identity.Resource = resolved.Resource
			if resolved.Namespaced {
				identity.Scope = ResourceScopeNamespaced
				identity.Openable = namespace != ""
				return identity
			}
			identity.Scope = ResourceScopeCluster
			identity.Namespace = ""
			identity.Openable = true
			return identity
		}
	}
	if namespaceExplicit && namespace != "" {
		identity.Scope = ResourceScopeNamespaced
		identity.Openable = true
	}
	return identity
}
