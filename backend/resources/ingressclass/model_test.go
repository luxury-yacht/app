package ingressclass_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/resources/ingressclass"
)

// TestBuildResourceModelFactsAndStatus covers the IngressClass status presentation
// + facts that moved here with the model (was in resourcemodel's network test).
func TestBuildResourceModelFactsAndStatus(t *testing.T) {
	ic := &networkingv1.IngressClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "nginx",
			Annotations: map[string]string{"ingressclass.kubernetes.io/is-default-class": "true"},
			UID:         types.UID("ingressclass-uid"),
		},
		Spec: networkingv1.IngressClassSpec{
			Controller: "k8s.io/ingress-nginx",
		},
	}

	model := ingressclass.BuildResourceModel("cluster-a", ic)
	require.Equal(t, "IngressClass", model.Ref.Kind)
	require.Equal(t, "true", model.Status.State)
	require.Equal(t, "Default", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	facts := ingressclass.BuildFacts(ic)
	require.True(t, facts.DefaultClass)
	require.Equal(t, "ingressclass.kubernetes.io/is-default-class", facts.DefaultClassAnnotation)
	require.Equal(t, "k8s.io/ingress-nginx", facts.Controller)
}
