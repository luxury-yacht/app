package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
)

func TestPreferredCRDVersion(t *testing.T) {
	t.Run("prefers served storage version", func(t *testing.T) {
		crd := &apiextensionsv1.CustomResourceDefinition{
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{
				Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
					{Name: "v1beta1", Served: true},
					{Name: "v1", Served: true, Storage: true},
				},
			},
		}

		require.Equal(t, "v1", preferredCRDVersion(crd))
	})

	t.Run("falls back to first served version", func(t *testing.T) {
		crd := &apiextensionsv1.CustomResourceDefinition{
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{
				Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
					{Name: "v1alpha1", Served: false},
					{Name: "v1beta1", Served: true},
					{Name: "v1", Served: false, Storage: true},
				},
			},
		}

		require.Equal(t, "v1beta1", preferredCRDVersion(crd))
	})

	t.Run("returns empty when no version is served", func(t *testing.T) {
		crd := &apiextensionsv1.CustomResourceDefinition{
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{
				Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
					{Name: "v1alpha1"},
					{Name: "v1", Storage: true},
				},
			},
		}

		require.Empty(t, preferredCRDVersion(crd))
	})
}
