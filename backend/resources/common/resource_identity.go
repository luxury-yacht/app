package common

import (
	"context"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// ResolvedResource is the canonical GVK -> GVR resolution result used by
// actions, permissions, YAML, and other dynamic resource paths.
type ResolvedResource struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}

func (r ResolvedResource) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    r.Group,
		Version:  r.Version,
		Resource: r.Resource,
	}
}

func (r ResolvedResource) GR() schema.GroupResource {
	return schema.GroupResource{
		Group:    r.Group,
		Resource: r.Resource,
	}
}

// ResourceResolver is an adapter for cluster-local resource identity sources,
// such as the object catalog's discovered descriptor set.
type ResourceResolver interface {
	ResolveResourceForGVK(ctx context.Context, gvk schema.GroupVersionKind) (ResolvedResource, bool, error)
}
