package backend

import (
	"context"
	"fmt"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Custom enrichments use the discovered GVR and the live GET authorization on
// every request. They do not enter the informer-invalidated built-in detail cache.
func (p *objectDetailProvider) fetchDiscoveredResourceDetails(ctx context.Context, resolved resolvedObjectDetailContext, gvk schema.GroupVersionKind, name string) (interface{}, error) {
	if !resolved.scoped {
		return nil, fmt.Errorf("cluster scope is required")
	}
	gvr, namespaced, err := resolveObjectYAMLGVR(ctx, resolved.deps, gvk, objectYAMLResolverStrict)
	if err != nil {
		return nil, err
	}
	if namespaced {
		return nil, fmt.Errorf("resource family requires a cluster-scoped resource")
	}
	if resolved.deps.DynamicClient == nil {
		return nil, fmt.Errorf("dynamic client not initialized")
	}
	object, err := resolved.deps.DynamicClient.Resource(gvr).Get(ctx, name, v1.GetOptions{})
	if err != nil {
		return nil, err
	}
	// Snapshot ETags read header metadata after details. Publish both from this
	// live object so a prior header cache entry cannot conceal a changed spec.
	p.gateway.responseCacheStore(resolved.selectionKey, objectHeaderMetadataCacheKey(gvk, "", name), objectHeaderMetadata(object))
	descriptor := customresource.NewDescriptor(gvr.Group, gvr.Version, gvr.Resource, gvk.Kind, gvr.Resource+"."+gvr.Group)
	clusterID := snapshot.ClusterMetaFromContext(ctx).ClusterID
	details := customresource.BuildDetails(clusterID, object, descriptor)
	if details.Karpenter != nil {
		details.Karpenter.NodeClass = p.gateway.objectCatalogServiceForCluster(clusterID).ResolveRelatedResourceLink(details.Karpenter.NodeClass)
	}
	return details, nil
}
