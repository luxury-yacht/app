package resourcemodel

import (
	"strconv"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
)

func BuildIngressClassResourceModel(clusterID string, ingressClass *networkingv1.IngressClass) ResourceModel {
	facts := BuildIngressClassFacts(ingressClass)
	status := BuildIngressClassStatusPresentation(ingressClass, facts)
	return networkResourceModel(clusterID, "networking.k8s.io", "v1", "IngressClass", "ingressclasses", ResourceScopeCluster, ingressClass.ObjectMeta, status, ResourceFacts{IngressClass: &facts})
}

func BuildIngressClassFacts(ingressClass *networkingv1.IngressClass) IngressClassFacts {
	defaultClassAnnotation, defaultClassAnnotationValue := networkDefaultClassAnnotation(ingressClass.Annotations)
	return IngressClassFacts{
		Controller:                  ingressClass.Spec.Controller,
		DefaultClass:                strings.EqualFold(defaultClassAnnotationValue, "true"),
		DefaultClassAnnotation:      defaultClassAnnotation,
		DefaultClassAnnotationValue: defaultClassAnnotationValue,
	}
}

func BuildIngressClassStatusPresentation(ingressClass *networkingv1.IngressClass, facts IngressClassFacts) ResourceStatusPresentation {
	state := strconv.FormatBool(facts.DefaultClass)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.controller", Status: facts.Controller},
		ingressClassDefaultSignal(facts),
	}
	lifecycle := NetworkLifecycle(ingressClass.ObjectMeta)
	if status, ok := DeletingNetworkStatus(ingressClass.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if facts.DefaultClass {
		return NetworkSourceStatus("Default", state, facts.DefaultClassAnnotation, "ready", signals, lifecycle)
	}
	return NetworkSourceStatus("Available", state, "", "ready", signals, lifecycle)
}

func ingressClassDefaultSignal(facts IngressClassFacts) ResourceStatusSignal {
	signal := ResourceStatusSignal{
		Type:   StatusSignalResourceState,
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
