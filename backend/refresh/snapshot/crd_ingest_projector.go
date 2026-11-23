/*
 * backend/refresh/snapshot/crd_ingest_projector.go
 *
 * CustomResourceDefinition's ingest projection. No table lists definitions
 * (API Resources lists the kinds they define, from discovery), so the owned
 * reflector keeps only what its other readers need: the Definition aggregate
 * that feeds API discovery's staleness hook and the dynamic custom-resource
 * sources, and the catalog Summary Browse lists.
 */

package snapshot

import (
	"errors"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

var (
	CustomResourceDefinitionGVR = apiextensions.Identity.GVR()
	CustomResourceDefinitionGVK = schema.GroupVersionKind{Group: apiextensions.Identity.Group, Version: apiextensions.Identity.Version, Kind: apiextensions.Identity.Kind}
)

// NewCustomResourceDefinitionIngestProjector returns the ProjectFunc for the
// owned CustomResourceDefinition reflector. Definitions have no table, so the
// bundle carries no Table half.
func NewCustomResourceDefinitionIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, apiextensions.Identity)
	return func(obj interface{}) (interface{}, error) {
		crd, ok := obj.(*apiextensionsv1.CustomResourceDefinition)
		if !ok {
			return nil, errors.New("ingest: definition projector received a non-CustomResourceDefinition object")
		}
		var metaObj metav1.Object = crd
		return ingest.Bundle{
			Aggregate: apiextensions.BuildDefinition(crd),
			Catalog:   catalogProject(metaObj),
		}, nil
	}
}
