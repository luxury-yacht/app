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

func BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(ctx context.Context, resolver common.ResourceResolver, clusterID, apiVersion, kind, namespace, name string, namespaceExplicit bool) ResourceLink {
	identity := ResolveHelmManifestResourceIdentityWithResolver(ctx, resolver, apiVersion, kind, namespace, name, namespaceExplicit)
	if !identity.Openable {
		return displayResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name)
	}
	if identity.Scope == ResourceScopeCluster {
		return ClusterResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Name, "")
	}
	return namespacedResourceLink(clusterID, identity.Group, identity.Version, identity.Kind, identity.Resource, identity.Namespace, identity.Name, "")
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


