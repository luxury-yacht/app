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
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// BuildNamespaceStreamSummary builds the namespace-custom row for one namespaced
// custom resource. defaultNamespace is used when the object carries no namespace.
func BuildNamespaceStreamSummary(meta streamrows.ClusterMeta, resource *unstructured.Unstructured, group, version, kindFallback, crdName, defaultNamespace string) streamrows.NamespaceCustomSummary {
	if resource == nil {
		return streamrows.NamespaceCustomSummary{
			ClusterMeta: meta,
			Kind:        kindFallback,
			Group:       group,
			Version:     version,
			CRDName:     crdName,
		}
	}
	gvr := schema.GroupVersionResource{Group: group, Version: version}
	model := BuildResourceModel(meta.ClusterID, resource, gvr, kindFallback, crdName, resourcemodel.ResourceScopeNamespaced, defaultNamespace)
	facts := BuildFacts(meta.ClusterID, resource, gvr, crdName, resourcemodel.ResourceModelBuildOptions{})
	return streamrows.NamespaceCustomSummary{
		ClusterMeta:        meta,
		Kind:               model.Ref.Kind,
		Name:               model.Ref.Name,
		Group:              model.Ref.Group,
		Version:            model.Ref.Version,
		CRDName:            crdName,
		Namespace:          model.Ref.Namespace,
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
func BuildClusterStreamSummary(meta streamrows.ClusterMeta, resource *unstructured.Unstructured, group, version, kindFallback, crdName string) streamrows.ClusterCustomSummary {
	if resource == nil {
		return streamrows.ClusterCustomSummary{
			ClusterMeta: meta,
			Kind:        kindFallback,
			Group:       group,
			Version:     version,
			CRDName:     crdName,
		}
	}
	gvr := schema.GroupVersionResource{Group: group, Version: version}
	model := BuildResourceModel(meta.ClusterID, resource, gvr, kindFallback, crdName, resourcemodel.ResourceScopeCluster, "")
	facts := BuildFacts(meta.ClusterID, resource, gvr, crdName, resourcemodel.ResourceModelBuildOptions{})
	return streamrows.ClusterCustomSummary{
		ClusterMeta:        meta,
		Kind:               model.Ref.Kind,
		Name:               model.Ref.Name,
		Group:              model.Ref.Group,
		Version:            model.Ref.Version,
		CRDName:            crdName,
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
