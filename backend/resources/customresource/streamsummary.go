/*
 * backend/resources/customresource/streamsummary.go
 *
 * Stream-summary builders for CRD-backed custom resources, owned by the
 * customresource package. They produce the neutral streamrows custom row types so
 * the snapshot namespace-custom / cluster-custom domains (and the dynamic stream
 * handlers) dispatch to them. No snapshot import.
 */

package customresource

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// BuildNamespaceStreamSummary builds the namespace-custom row for one namespaced
// custom resource. defaultNamespace is used when the object carries no namespace.
func BuildNamespaceStreamSummary(meta streamrows.ClusterMeta, resource *unstructured.Unstructured, descriptor Descriptor, defaultNamespace string) streamrows.NamespaceCustomSummary {
	if resource == nil {
		return streamrows.NamespaceCustomSummary{
			Ref: resourcemodel.NewResourceRef(resourcemodel.ResourceRef{
				ClusterID: meta.ClusterID, Group: descriptor.GVR.Group, Version: descriptor.GVR.Version,
				Kind: descriptor.KindFallback, Resource: descriptor.GVR.Resource,
			}),
			CRDName: descriptor.CRDName,
		}
	}
	gvr := descriptor.GVR
	model := BuildResourceModel(meta.ClusterID, resource, descriptor, resourcemodel.ResourceScopeNamespaced, defaultNamespace)
	facts := BuildFacts(meta.ClusterID, resource, gvr, descriptor.CRDName, resourcemodel.ResourceModelBuildOptions{})
	return streamrows.NamespaceCustomSummary{
		Ref:                model.Ref,
		CRDName:            descriptor.CRDName,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		Ready:              facts.Ready,
		ObservedGeneration: facts.ObservedGeneration,
		Conditions:         facts.Conditions,
		Age:                streamrows.FormatAge(model.Metadata.CreationTimestamp.Time),
		Labels:             model.Metadata.Labels,
		Annotations:        model.Metadata.Annotations,
	}
}

// BuildClusterStreamSummary builds the cluster-custom row for one cluster-scoped
// custom resource.
func BuildClusterStreamSummary(meta streamrows.ClusterMeta, resource *unstructured.Unstructured, descriptor Descriptor) streamrows.ClusterCustomSummary {
	if resource == nil {
		return streamrows.ClusterCustomSummary{
			Ref: resourcemodel.NewResourceRef(resourcemodel.ResourceRef{
				ClusterID: meta.ClusterID, Group: descriptor.GVR.Group, Version: descriptor.GVR.Version,
				Kind: descriptor.KindFallback, Resource: descriptor.GVR.Resource,
			}),
			CRDName: descriptor.CRDName,
		}
	}
	gvr := descriptor.GVR
	model := BuildResourceModel(meta.ClusterID, resource, descriptor, resourcemodel.ResourceScopeCluster, "")
	facts := BuildFacts(meta.ClusterID, resource, gvr, descriptor.CRDName, resourcemodel.ResourceModelBuildOptions{})
	return streamrows.ClusterCustomSummary{
		Ref:                model.Ref,
		CRDName:            descriptor.CRDName,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		Ready:              facts.Ready,
		ObservedGeneration: facts.ObservedGeneration,
		Conditions:         facts.Conditions,
		Age:                streamrows.FormatAge(model.Metadata.CreationTimestamp.Time),
		Labels:             model.Metadata.Labels,
		Annotations:        model.Metadata.Annotations,
	}
}
