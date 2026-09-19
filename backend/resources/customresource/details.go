package customresource

import (
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/argocd"
	"github.com/luxury-yacht/app/backend/resources/certmanager"
	"github.com/luxury-yacht/app/backend/resources/externalsecrets"
	"github.com/luxury-yacht/app/backend/resources/karpenter"
	"github.com/luxury-yacht/app/backend/resources/prometheus"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// Details enriches discovery-backed objects without declaring their GVK built-in.
type Details struct {
	CertManager        *certmanager.Facts             `json:"certManager,omitempty"`
	ExternalSecrets    *externalsecrets.Facts         `json:"externalSecrets,omitempty"`
	Prometheus         *prometheus.Facts              `json:"prometheus,omitempty"`
	ArgoCD             *argocd.Facts                  `json:"argoCD,omitempty"`
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

func BuildDetails(clusterID string, object *unstructured.Unstructured, descriptor Descriptor, scope resourcemodel.ResourceScope) *Details {
	facts := BuildFacts(object)
	model := buildResourceModel(clusterID, object, descriptor, scope, "", facts)
	return &Details{
		CertManager:     certmanager.BuildFacts(clusterID, object),
		ExternalSecrets: externalsecrets.BuildFacts(clusterID, object),
		Prometheus:      prometheus.BuildFacts(clusterID, object),
		Ref:             model.Ref, ResourceFamily: resourcekind.FamilyForResource(descriptor.GVR.Group, model.Ref.Kind, scope == resourcemodel.ResourceScopeNamespaced),
		Kind: model.Ref.Kind, Name: model.Ref.Name, Status: model.Status.Label,
		StatusState: model.Status.State, StatusPresentation: model.Status.Presentation,
		Conditions: facts.Conditions, Labels: model.Metadata.Labels, Annotations: model.Metadata.Annotations,
		Karpenter: karpenter.BuildFacts(clusterID, object), ArgoCD: argocd.BuildFacts(clusterID, object),
	}
}
