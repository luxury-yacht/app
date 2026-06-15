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
	require.Equal(t, 1, facts.ExtraServedVersionCount)
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
	require.Equal(t, 1, facts.ExtraServedVersionCount)
}

// TestBuildFactsVersionSummary covers the storage-version + extra-served-count
// derivation (formerly the snapshot crdVersionSummary helper) that drives the
// Version column in the CRDs view.
func TestBuildFactsVersionSummary(t *testing.T) {
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
		wantExtra   int
	}{
		{"empty versions returns zero values", makeCRD(), "", 0},
		{"single served+storage version returns version with no extras", makeCRD(v("v1", true, true)), "v1", 0},
		{"multi-version with v1 as storage counts the other served versions", makeCRD(v("v1alpha1", true, false), v("v1beta1", true, false), v("v1", true, true)), "v1", 2},
		{"storage version not served counts all served as extras", makeCRD(v("v1alpha1", false, true), v("v1", true, false)), "v1alpha1", 1},
		{"non-served versions are ignored in the extras count", makeCRD(v("v1", true, true), v("v1alpha1", false, false)), "v1", 0},
		{"falls back to first served version when no storage flag", makeCRD(v("v1alpha1", false, false), v("v1beta1", true, false), v("v1", true, false)), "v1beta1", 1},
		{"falls back to first version when nothing is served", makeCRD(v("v1alpha1", false, false)), "v1alpha1", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			facts := BuildFacts(tt.crd)
			require.Equal(t, tt.wantStorage, facts.StorageVersion)
			require.Equal(t, tt.wantExtra, facts.ExtraServedVersionCount)
		})
	}
}
