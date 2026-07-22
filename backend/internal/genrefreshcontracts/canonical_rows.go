package genrefreshcontracts

import (
	"reflect"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

type canonicalObjectRowSpec struct {
	name               string
	typeOf             reflect.Type
	semanticJSONFields map[string]string
}

func canonicalObjectRowSpecs() []canonicalObjectRowSpec {
	return []canonicalObjectRowSpec{
		{name: "namespaces", typeOf: typeOf[snapshot.NamespaceSummary]()},
		{name: "namespace-metrics", typeOf: typeOf[snapshot.NamespaceMetric]()},
		{
			name:   "nodes",
			typeOf: typeOf[streamrows.NodeSummary](),
			semanticJSONFields: map[string]string{
				"version": "kubelet software version",
			},
		},
		{
			name:   "cluster-attention",
			typeOf: typeOf[snapshot.AttentionFinding](),
			semanticJSONFields: map[string]string{
				"namespace": "affected-object display namespace; Event refs identify the Event itself",
			},
		},
		{name: "catalog", typeOf: typeOf[objectcatalog.Summary]()},
		{name: "cluster-config", typeOf: typeOf[streamrows.ClusterConfigEntry]()},
		{
			name:   "cluster-crds",
			typeOf: typeOf[streamrows.ClusterCRDEntry](),
			semanticJSONFields: map[string]string{
				"group": "API group described by the CRD object",
			},
		},
		{name: "cluster-rbac", typeOf: typeOf[streamrows.ClusterRBACEntry]()},
		{name: "cluster-storage", typeOf: typeOf[streamrows.ClusterStorageEntry]()},
		{name: "cluster-events", typeOf: typeOf[snapshot.ClusterEventEntry]()},
		{name: "namespace-config", typeOf: typeOf[streamrows.ConfigSummary]()},
		{name: "namespace-network", typeOf: typeOf[streamrows.NetworkSummary]()},
		{name: "namespace-rbac", typeOf: typeOf[streamrows.RBACSummary]()},
		{name: "namespace-storage", typeOf: typeOf[streamrows.StorageSummary]()},
		{name: "namespace-autoscaling", typeOf: typeOf[streamrows.AutoscalingSummary]()},
		{name: "namespace-quotas", typeOf: typeOf[streamrows.QuotaSummary]()},
		{
			name:   "namespace-events",
			typeOf: typeOf[snapshot.EventSummary](),
			semanticJSONFields: map[string]string{
				"kind": "involved-object kind used by the Event query",
			},
		},
		{name: "namespace-helm", typeOf: typeOf[snapshot.NamespaceHelmSummary]()},
		{name: "pods", typeOf: typeOf[streamrows.PodSummary]()},
		{name: "namespace-workloads", typeOf: typeOf[streamrows.WorkloadSummary]()},
		{name: "namespace-custom-legacy", typeOf: typeOf[streamrows.NamespaceCustomSummary]()},
		{name: "cluster-custom-legacy", typeOf: typeOf[streamrows.ClusterCustomSummary]()},
		{name: "custom-page-hydration", typeOf: typeOf[snapshot.CustomResourceSummary]()},
		{name: "object-events", typeOf: typeOf[snapshot.ObjectEventSummary]()},
	}
}

func isCanonicalObjectRowType(typeOf reflect.Type) bool {
	typeOf = indirect(typeOf)
	for _, spec := range canonicalObjectRowSpecs() {
		if indirect(spec.typeOf) == typeOf {
			return true
		}
	}
	return false
}
