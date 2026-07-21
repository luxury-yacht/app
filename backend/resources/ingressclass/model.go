/*
 * backend/resources/ingressclass/model.go
 *
 * IngressClass resource model: the single definition of an IngressClass's
 * intrinsic fields + status presentation. Detail/object-map/streaming projections
 * derive from it. Shared model helpers are reused from resourcemodel (exported base).
 */

package ingressclass

import (
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	networkingv1 "k8s.io/api/networking/v1"
)

// BuildResourceModel builds the IngressClass resource model. Facts are owned by
// this package (ingressclass.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, ingressClass *networkingv1.IngressClass) resourcemodel.ResourceModel {
	facts := BuildFacts(ingressClass)
	status := statusPresentation(ingressClass, facts)
	return resourcemodel.KubernetesResourceModel(clusterID, "networking.k8s.io", "v1", "IngressClass", "ingressclasses", resourcemodel.ResourceScopeCluster, ingressClass.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the IngressClass facts from the raw object.
func BuildFacts(ingressClass *networkingv1.IngressClass) Facts {
	defaultClassAnnotation, defaultClassAnnotationValue := resourcemodel.NetworkDefaultClassAnnotation(ingressClass.Annotations)
	return Facts{
		Controller:                  ingressClass.Spec.Controller,
		DefaultClass:                strings.EqualFold(defaultClassAnnotationValue, "true"),
		DefaultClassAnnotation:      defaultClassAnnotation,
		DefaultClassAnnotationValue: defaultClassAnnotationValue,
	}
}

func statusPresentation(ingressClass *networkingv1.IngressClass, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strconv.FormatBool(facts.DefaultClass)
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.controller", Status: facts.Controller},
		ingressClassDefaultSignal(facts),
	}
	lifecycle := resourcemodel.ObjectLifecycle(ingressClass.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(ingressClass.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if facts.DefaultClass {
		return resourcemodel.ObjectSourceStatus("Default", state, facts.DefaultClassAnnotation, "", "ready", signals, lifecycle)
	}
	return resourcemodel.ObjectSourceStatus("Available", state, "", "", "ready", signals, lifecycle)
}

func ingressClassDefaultSignal(facts Facts) resourcemodel.ResourceStatusSignal {
	signal := resourcemodel.ResourceStatusSignal{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "metadata.annotations",
		Status: strconv.FormatBool(facts.DefaultClass),
	}
	if facts.DefaultClassAnnotation != "" {
		signal.Name = "metadata.annotations." + facts.DefaultClassAnnotation
		signal.Status = facts.DefaultClassAnnotationValue
		signal.Reason = facts.DefaultClassAnnotation
	}
	return signal
}
