package snapshot

import "github.com/luxury-yacht/app/backend/resourcemodel"

// CustomResourceSummary is the page-hydration row shape used by catalog-backed
// custom-resource tables. It preserves the rich status and metadata fields from
// the legacy namespace/cluster custom snapshot rows without requiring the
// production Custom tabs to subscribe to full CRD fanout domains.
type CustomResourceSummary struct {
	ClusterMeta
	Kind               string                         `json:"kind"`
	Name               string                         `json:"name"`
	Namespace          string                         `json:"namespace,omitempty"`
	Group              string                         `json:"group"`
	Version            string                         `json:"version"`
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

func CustomResourceSummaryFromNamespace(row NamespaceCustomSummary) CustomResourceSummary {
	return CustomResourceSummary{
		ClusterMeta:        row.ClusterMeta,
		Kind:               row.Kind,
		Name:               row.Name,
		Namespace:          row.Namespace,
		Group:              row.Group,
		Version:            row.Version,
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

func CustomResourceSummaryFromCluster(row ClusterCustomSummary) CustomResourceSummary {
	return CustomResourceSummary{
		ClusterMeta:        row.ClusterMeta,
		Kind:               row.Kind,
		Name:               row.Name,
		Group:              row.Group,
		Version:            row.Version,
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
