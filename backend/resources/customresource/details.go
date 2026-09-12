package customresource

import (
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/karpenter"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// Details enriches discovery-backed objects without declaring their GVK built-in.
type Details struct {
	Ref                resourcemodel.ResourceRef      `json:"ref"`
	ResourceFamily     string                         `json:"resourceFamily"`
	Kind               string                         `json:"kind"`
	Name               string                         `json:"name"`
	Status             string                         `json:"status"`
	StatusState        string                         `json:"statusState"`
	StatusPresentation string                         `json:"statusPresentation"`
	Conditions         []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	Labels             map[string]string              `json:"labels,omitempty"`
	Annotations        map[string]string              `json:"annotations,omitempty"`
	Karpenter          *karpenter.Facts               `json:"karpenter,omitempty"`
}

func BuildDetails(clusterID string, object *unstructured.Unstructured, descriptor Descriptor) *Details {
	model := BuildResourceModel(clusterID, object, descriptor, resourcemodel.ResourceScopeCluster, "")
	facts := BuildFacts(clusterID, object, descriptor.GVR, descriptor.CRDName, resourcemodel.ResourceModelBuildOptions{})
	return &Details{
		Ref: model.Ref, ResourceFamily: resourcekind.FamilyForResource(descriptor.GVR.Group, false),
		Kind: model.Ref.Kind, Name: model.Ref.Name, Status: model.Status.Label,
		StatusState: model.Status.State, StatusPresentation: model.Status.Presentation,
		Conditions: facts.Conditions, Labels: model.Metadata.Labels, Annotations: model.Metadata.Annotations,
		Karpenter: karpenter.BuildFacts(clusterID, object),
	}
}
