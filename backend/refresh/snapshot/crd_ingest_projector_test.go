package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

// The CRD reflector has no table to feed. Its bundle carries what its readers
// need: the Definition that API discovery and the dynamic custom-resource
// sources read, and the catalog row that lists the CRD object in Browse.
func TestCustomResourceDefinitionProjectorCarriesTheDefinitionAndItsCatalogRow(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "widgets-uid"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group:    "example.com",
			Scope:    apiextensionsv1.NamespaceScoped,
			Names:    apiextensionsv1.CustomResourceDefinitionNames{Plural: "widgets", Kind: "Widget"},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
		},
	}

	projected, err := NewCustomResourceDefinitionIngestProjector(ClusterMeta{ClusterID: "c1"})(crd)
	require.NoError(t, err)
	bundle := projected.(ingest.Bundle)

	require.Equal(t, apiextensions.BuildDefinition(crd), bundle.Aggregate)
	row := bundle.Catalog.(objectcatalog.Summary)
	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, apiextensions.Identity.Group, row.Ref.Group)
	require.Equal(t, apiextensions.Identity.Version, row.Ref.Version)
	require.Equal(t, apiextensions.Identity.Kind, row.Ref.Kind)
	require.Equal(t, "widgets.example.com", row.Ref.Name)
	require.Nil(t, bundle.Table, "definitions have no table")

	_, err = NewCustomResourceDefinitionIngestProjector(ClusterMeta{})(&corev1.Pod{})
	require.Error(t, err, "an object of another kind is a projection error, not a panic")
}
