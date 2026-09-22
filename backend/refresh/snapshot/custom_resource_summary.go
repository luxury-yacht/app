package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// CustomResourceSummary is the page-hydration row shape used by catalog-backed
// custom-resource tables. Rich status and metadata are fetched only after
// catalog membership has identified the requested rows.
type CustomResourceSummary struct {
	CertManager     *streamrows.CertManagerSummary     `json:"certManager,omitempty"`
	ExternalSecrets *streamrows.ExternalSecretsSummary `json:"externalSecrets,omitempty"`
	Prometheus      *streamrows.PrometheusSummary      `json:"prometheus,omitempty"`

	ArgoCD             *streamrows.ArgoCDSummary      `json:"argoCD,omitempty"`
	Karpenter          *streamrows.KarpenterSummary   `json:"karpenter,omitempty"`
	Ref                resourcemodel.ResourceRef      `json:"ref"`
	CRDName            string                         `json:"crdName,omitempty"`
	Status             string                         `json:"status,omitempty"`
	StatusState        string                         `json:"statusState,omitempty"`
	StatusPresentation string                         `json:"statusPresentation,omitempty"`
	Ready              *bool                          `json:"ready,omitempty"`
	ObservedGeneration *int64                         `json:"observedGeneration,omitempty"`
	Conditions         []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	Age                string                         `json:"age"`
	Labels             map[string]string              `json:"labels,omitempty"`
	Annotations        map[string]string              `json:"annotations,omitempty"`
}

func (row *CustomResourceSummary) ResolveLinks(resolve func(*resourcemodel.ResourceLink) *resourcemodel.ResourceLink) {
	if row.Karpenter != nil {
		row.Karpenter.NodeClass = resolve(row.Karpenter.NodeClass)
	}
	if row.CertManager != nil {
		row.CertManager.Issuer = resolve(row.CertManager.Issuer)
	}
	if row.ExternalSecrets != nil {
		row.ExternalSecrets.Store = resolve(row.ExternalSecrets.Store)
	}
}

func CustomResourceSummaryFromNamespace(row streamrows.NamespaceCustomSummary) CustomResourceSummary {
	return CustomResourceSummary{
		CertManager: row.CertManager, ExternalSecrets: row.ExternalSecrets, Prometheus: row.Prometheus,
		ArgoCD:             row.ArgoCD,
		Ref:                row.Ref,
		CRDName:            row.CRDName,
		Status:             row.Status,
		StatusState:        row.StatusState,
		StatusPresentation: row.StatusPresentation,
		Ready:              row.Ready,
		ObservedGeneration: row.ObservedGeneration,
		Conditions:         row.Conditions,
		Age:                row.Age,
		Labels:             row.Labels,
		Annotations:        row.Annotations,
	}
}

func CustomResourceSummaryFromCluster(row streamrows.ClusterCustomSummary) CustomResourceSummary {
	return CustomResourceSummary{
		CertManager: row.CertManager, ExternalSecrets: row.ExternalSecrets, Prometheus: row.Prometheus,
		Karpenter:          row.Karpenter,
		Ref:                row.Ref,
		CRDName:            row.CRDName,
		Status:             row.Status,
		StatusState:        row.StatusState,
		StatusPresentation: row.StatusPresentation,
		Ready:              row.Ready,
		ObservedGeneration: row.ObservedGeneration,
		Conditions:         row.Conditions,
		Age:                row.Age,
		Labels:             row.Labels,
		Annotations:        row.Annotations,
	}
}
