/*
 * backend/resources/apiextensions/crds_test.go
 *
 * Tests for CustomResourceDefinition resource handlers.
 * - Covers CustomResourceDefinition resource handlers behavior and edge cases.
 */

package apiextensions

import (
	"context"
	"testing"
	"time"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestCustomResourceDefinition(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "widgets.example.com",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-time.Hour)),
			Labels:            map[string]string{"app": "demo"},
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural:     "widgets",
				Singular:   "widget",
				Kind:       "Widget",
				ListKind:   "WidgetList",
				ShortNames: []string{"wd"},
				Categories: []string{"all"},
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{
					Name:    "v1",
					Served:  true,
					Storage: true,
					Schema:  &apiextensionsv1.CustomResourceValidation{},
				},
			},
		},
		Status: apiextensionsv1.CustomResourceDefinitionStatus{
			Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{{
				Type:   apiextensionsv1.Established,
				Status: apiextensionsv1.ConditionTrue,
				Reason: "Ready",
			}},
		},
	}

	client := apiextfake.NewClientset(crd)
	var ensureCalled bool
	svc := NewService(common.Dependencies{
			Context:             context.Background(),
			Logger:              testsupport.NoopLogger{},
			APIExtensionsClient: client,
			EnsureAPIExtensions: func(resource string) error {
				ensureCalled = true
				if resource != "CustomResourceDefinition" {
					t.Fatalf("EnsureAPIExtensions received unexpected resource %q", resource)
				}
				return nil
			},
	})

	details, err := svc.CustomResourceDefinition("widgets.example.com")
	if err != nil {
		t.Fatalf("CustomResourceDefinition returned error: %v", err)
	}
	if !ensureCalled {
		t.Fatalf("expected EnsureAPIExtensions to be invoked")
	}
	if details == nil {
		t.Fatalf("expected details to be returned")
	}
	if details.Name != "widgets.example.com" || details.Kind != "CustomResourceDefinition" {
		t.Fatalf("unexpected CRD details: %#v", details)
	}
	if len(details.Versions) != 1 || details.Versions[0].Name != "v1" {
		t.Fatalf("expected CRD versions to be captured, got %#v", details.Versions)
	}
	if len(details.Conditions) != 1 || details.Conditions[0].Kind != string(apiextensionsv1.Established) {
		t.Fatalf("expected CRD conditions to be copied, got %#v", details.Conditions)
	}
}

func TestCustomResourceDefinitionsList(t *testing.T) {
	crd1 := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name: "widgets.example.com",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Scope: apiextensionsv1.ClusterScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
		},
	}
	crd2 := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name: "gadgets.example.com",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "gadgets",
				Kind:   "Gadget",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
		},
	}

	client := apiextfake.NewClientset(crd1, crd2)
	svc := NewService(common.Dependencies{
		Context:             context.Background(),
		Logger:              testsupport.NoopLogger{},
		APIExtensionsClient: client,
	})

	list, err := svc.CustomResourceDefinitions()
	if err != nil {
		t.Fatalf("CustomResourceDefinitions returned error: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 CRDs, got %d", len(list))
	}
	names := []string{list[0].Name, list[1].Name}
	expected := map[string]bool{"widgets.example.com": true, "gadgets.example.com": true}
	for _, name := range names {
		if !expected[name] {
			t.Fatalf("unexpected CRD name %q in list", name)
		}
	}
}
