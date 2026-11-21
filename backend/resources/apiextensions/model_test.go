package apiextensions

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildResourceModelFactsStatusAndVersions(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "uid-1"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural:     "widgets",
				Singular:   "widget",
				Kind:       "Widget",
				ListKind:   "WidgetList",
				ShortNames: []string{"wdg"},
				Categories: []string{"all"},
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1beta1", Served: true, Storage: false, Deprecated: true},
				{
					Name:    "v1",
					Served:  true,
					Storage: true,
					Schema: &apiextensionsv1.CustomResourceValidation{
						OpenAPIV3Schema: &apiextensionsv1.JSONSchemaProps{Type: "object"},
					},
				},
				{Name: "v2alpha1", Served: false, Storage: false},
			},
			Conversion: &apiextensionsv1.CustomResourceConversion{Strategy: apiextensionsv1.WebhookConverter},
		},
		Status: apiextensionsv1.CustomResourceDefinitionStatus{
			Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{{
				Type:   apiextensionsv1.Established,
				Status: apiextensionsv1.ConditionTrue,
				Reason: "InitialNamesAccepted",
			}},
		},
	}

	model := BuildResourceModel("cluster-a", crd)
	require.Equal(t, resourcemodel.ResourceRef{
		ClusterID: "cluster-a",
		Group:     "apiextensions.k8s.io",
		Version:   "v1",
		Kind:      "CustomResourceDefinition",
		Resource:  "customresourcedefinitions",
		Name:      "widgets.example.com",
		UID:       "uid-1",
	}, model.Ref)

	facts := BuildFacts(crd)
	require.Equal(t, "example.com", facts.Group)
	require.Equal(t, "Namespaced", facts.Scope)
	require.Equal(t, "Widget", facts.Names.Kind)
	require.Equal(t, []string{"wdg"}, facts.Names.ShortNames)
	require.Equal(t, "Webhook", facts.ConversionStrategy)
	require.Equal(t, "v1", facts.StorageVersion)
	require.Equal(t, "Versions: v1beta1,v1*,v2alpha1", CustomResourceDefinitionVersionDetails(facts))
	require.False(t, facts.Versions[0].HasSchema)
	require.True(t, facts.Versions[1].HasSchema)
	require.Equal(t, "Established", facts.Conditions[0].Type)
	require.Equal(t, "True", facts.Conditions[0].Status)
	require.Equal(t, "Versions: v1beta1,v1*,v2alpha1", model.Status.Label)
	require.Equal(t, "v1", model.Status.State)
}

func TestBuildFactsFallsBackToServedVersion(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1alpha1", Served: false},
				{Name: "v1beta1", Served: true},
				{Name: "v1", Served: true},
			},
		},
	}

	facts := BuildFacts(crd)
	require.Equal(t, "v1beta1", facts.StorageVersion)
}

// The storage version is the one the status presentation reports as the
// CRD's state: the version flagged as storage, else the first served version,
// else the first listed.
func TestBuildFactsStorageVersion(t *testing.T) {
	makeCRD := func(versions ...apiextensionsv1.CustomResourceDefinitionVersion) *apiextensionsv1.CustomResourceDefinition {
		return &apiextensionsv1.CustomResourceDefinition{
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{Versions: versions},
		}
	}
	v := func(name string, served, storage bool) apiextensionsv1.CustomResourceDefinitionVersion {
		return apiextensionsv1.CustomResourceDefinitionVersion{Name: name, Served: served, Storage: storage}
	}

	tests := []struct {
		name        string
		crd         *apiextensionsv1.CustomResourceDefinition
		wantStorage string
	}{
		{"no versions", makeCRD(), ""},
		{"the version flagged as storage", makeCRD(v("v1alpha1", true, false), v("v1beta1", true, false), v("v1", true, true)), "v1"},
		{"a storage version that is not served", makeCRD(v("v1alpha1", false, true), v("v1", true, false)), "v1alpha1"},
		{"the first served version when none is flagged as storage", makeCRD(v("v1alpha1", false, false), v("v1beta1", true, false), v("v1", true, false)), "v1beta1"},
		{"the first version when nothing is served", makeCRD(v("v1alpha1", false, false)), "v1alpha1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.wantStorage, BuildFacts(tt.crd).StorageVersion)
		})
	}
}
