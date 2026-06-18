/*
 * backend/resources/apiextensions/streamsummary.go
 *
 * CustomResourceDefinition's stream-summary builder, owned by the kind's package.
 * Produces the neutral streamrows.ClusterCRDEntry row (cluster-crds). No snapshot
 * import.
 */

package apiextensions

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
)

// BuildStreamSummary builds the cluster-crds row for one CustomResourceDefinition.
func BuildStreamSummary(meta streamrows.ClusterMeta, crd *apiextensionsv1.CustomResourceDefinition) streamrows.ClusterCRDEntry {
	if crd == nil {
		return streamrows.ClusterCRDEntry{ClusterMeta: meta, Kind: "CustomResourceDefinition"}
	}
	facts := BuildFacts(crd)
	return streamrows.ClusterCRDEntry{
		ClusterMeta:             meta,
		Kind:                    "CustomResourceDefinition",
		Name:                    crd.Name,
		Group:                   facts.Group,
		Scope:                   facts.Scope,
		Details:                 CustomResourceDefinitionVersionDetails(facts),
		StorageVersion:          facts.StorageVersion,
		ExtraServedVersionCount: facts.ExtraServedVersionCount,
		Age:                     streamrows.FormatAge(crd.CreationTimestamp.Time),
		AgeTimestamp:            streamrows.CreationMillis(crd),
		TypeAlias:               "CRD",
	}
}
