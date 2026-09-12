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
	"github.com/luxury-yacht/app/backend/resources/argocd"
	"github.com/luxury-yacht/app/backend/resources/karpenter"
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
		ArgoCD:             argoCDTableSummary(argocd.BuildFacts(meta.ClusterID, resource), model.Status),
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
		Karpenter:          karpenterTableSummary(karpenter.BuildFacts(meta.ClusterID, resource)),
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

func karpenterTableSummary(facts *karpenter.Facts) *streamrows.KarpenterSummary {
	if facts == nil {
		return nil
	}
	return &streamrows.KarpenterSummary{
		NodePool: facts.NodePool, NodeClass: facts.NodeClass,
		InstanceType: facts.InstanceType, CapacityType: facts.CapacityType,
		Capacity: facts.Capacity, Limits: facts.Limits,
	}
}

func argoCDTableSummary(facts *argocd.Facts, status resourcemodel.ResourceStatusPresentation) *streamrows.ArgoCDSummary {
	if facts == nil {
		return nil
	}
	summary := &streamrows.ArgoCDSummary{}
	if facts.Application != nil || facts.ApplicationSet != nil || status.Presentation == "terminating" {
		summary.Health = status.Label
		summary.HealthPresentation = status.Presentation
	}
	var spec argocd.ApplicationSpec
	if facts.Application != nil {
		spec = facts.Application.Spec
		summary.Sync = facts.Application.Sync
		summary.SyncPresentation = facts.Application.SyncPresentation
	}
	if facts.ApplicationSet != nil {
		spec = facts.ApplicationSet.Template
	}
	summary.Project = spec.Project
	summary.Destination = spec.Destination.Name
	if summary.Destination == "" {
		summary.Destination = spec.Destination.Server
	}
	summary.DestinationNamespace = spec.Destination.Namespace
	return summary
}
