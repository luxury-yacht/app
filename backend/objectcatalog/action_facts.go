package objectcatalog

import (
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func buildSummaryActionFacts(desc resourceDescriptor, item metav1.Object) *ActionFacts {
	if item == nil {
		return nil
	}
	switch obj := item.(type) {
	case *corev1.Pod:
		available := hasForwardableContainerPorts(obj.Spec.Containers)
		return &ActionFacts{PortForwardAvailable: &available}
	case *corev1.Service:
		available := serviceHasForwardablePorts(obj.Spec.Ports)
		return &ActionFacts{PortForwardAvailable: &available}
	case *corev1.Node:
		unschedulable := obj.Spec.Unschedulable
		return &ActionFacts{Unschedulable: &unschedulable}
	case *appsv1.Deployment:
		available := hasForwardableContainerPorts(obj.Spec.Template.Spec.Containers)
		return &ActionFacts{
			PortForwardAvailable: &available,
			DesiredReplicas:      obj.Spec.Replicas,
		}
	case *appsv1.StatefulSet:
		available := hasForwardableContainerPorts(obj.Spec.Template.Spec.Containers)
		return &ActionFacts{
			PortForwardAvailable: &available,
			DesiredReplicas:      obj.Spec.Replicas,
		}
	case *appsv1.DaemonSet:
		available := hasForwardableContainerPorts(obj.Spec.Template.Spec.Containers)
		return &ActionFacts{PortForwardAvailable: &available}
	case *appsv1.ReplicaSet:
		available := hasForwardableContainerPorts(obj.Spec.Template.Spec.Containers)
		return &ActionFacts{
			PortForwardAvailable: &available,
			DesiredReplicas:      obj.Spec.Replicas,
		}
	case *batchv1.Job:
		available := hasForwardableContainerPorts(obj.Spec.Template.Spec.Containers)
		return &ActionFacts{PortForwardAvailable: &available}
	case *batchv1.CronJob:
		available := hasForwardableContainerPorts(obj.Spec.JobTemplate.Spec.Template.Spec.Containers)
		facts := &ActionFacts{PortForwardAvailable: &available}
		if obj.Spec.Suspend != nil && *obj.Spec.Suspend {
			facts.Status = "Suspended"
		}
		return facts
	case *autoscalingv1.HorizontalPodAutoscaler:
		return &ActionFacts{ScaleTarget: actionScaleTargetFromV1HPA(obj)}
	case *autoscalingv2.HorizontalPodAutoscaler:
		return &ActionFacts{ScaleTarget: actionScaleTargetFromV2HPA(obj)}
	case *unstructuredv1.Unstructured:
		return buildUnstructuredSummaryActionFacts(desc, obj)
	default:
		return nil
	}
}

func buildUnstructuredSummaryActionFacts(desc resourceDescriptor, item *unstructuredv1.Unstructured) *ActionFacts {
	if item == nil {
		return nil
	}
	switch {
	case desc.Group == "" && desc.Version == "v1" && desc.Kind == "Pod":
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "containers")
		return &ActionFacts{PortForwardAvailable: &available}
	case desc.Group == "" && desc.Version == "v1" && desc.Kind == "Service":
		available := unstructuredServiceHasForwardablePorts(item.Object)
		return &ActionFacts{PortForwardAvailable: &available}
	case desc.Group == "" && desc.Version == "v1" && desc.Kind == "Node":
		unschedulable, _, _ := unstructuredv1.NestedBool(item.Object, "spec", "unschedulable")
		return &ActionFacts{Unschedulable: &unschedulable}
	case desc.Group == "apps" && desc.Version == "v1" && desc.Kind == "Deployment":
		return unstructuredScalableWorkloadFacts(item, "spec", "template", "spec", "containers")
	case desc.Group == "apps" && desc.Version == "v1" && desc.Kind == "StatefulSet":
		return unstructuredScalableWorkloadFacts(item, "spec", "template", "spec", "containers")
	case desc.Group == "apps" && desc.Version == "v1" && desc.Kind == "ReplicaSet":
		return unstructuredScalableWorkloadFacts(item, "spec", "template", "spec", "containers")
	case desc.Group == "apps" && desc.Version == "v1" && desc.Kind == "DaemonSet":
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "template", "spec", "containers")
		return &ActionFacts{PortForwardAvailable: &available}
	case desc.Group == "batch" && desc.Version == "v1" && desc.Kind == "Job":
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "template", "spec", "containers")
		return &ActionFacts{PortForwardAvailable: &available}
	case desc.Group == "batch" && desc.Version == "v1" && desc.Kind == "CronJob":
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "jobTemplate", "spec", "template", "spec", "containers")
		facts := &ActionFacts{PortForwardAvailable: &available}
		if suspended, found, _ := unstructuredv1.NestedBool(item.Object, "spec", "suspend"); found && suspended {
			facts.Status = "Suspended"
		}
		return facts
	case desc.Group == "autoscaling" && desc.Kind == "HorizontalPodAutoscaler":
		if target := unstructuredHPAScaleTarget(item); target != nil {
			return &ActionFacts{ScaleTarget: target}
		}
	}
	return nil
}

func unstructuredScalableWorkloadFacts(item *unstructuredv1.Unstructured, containerPath ...string) *ActionFacts {
	available := unstructuredHasForwardableContainerPorts(item.Object, containerPath...)
	facts := &ActionFacts{PortForwardAvailable: &available}
	if replicas, found, _ := unstructuredv1.NestedInt64(item.Object, "spec", "replicas"); found {
		value := int32(replicas)
		facts.DesiredReplicas = &value
	}
	return facts
}

func hasForwardableContainerPorts(containers []corev1.Container) bool {
	for _, container := range containers {
		for _, port := range container.Ports {
			if port.Protocol == "" || port.Protocol == corev1.ProtocolTCP {
				return true
			}
		}
	}
	return false
}

func serviceHasForwardablePorts(ports []corev1.ServicePort) bool {
	for _, port := range ports {
		if port.Protocol == "" || port.Protocol == corev1.ProtocolTCP {
			return true
		}
	}
	return false
}

func unstructuredHasForwardableContainerPorts(obj map[string]any, fields ...string) bool {
	containers, found, _ := unstructuredv1.NestedSlice(obj, fields...)
	if !found {
		return false
	}
	for _, value := range containers {
		container, ok := value.(map[string]any)
		if !ok {
			continue
		}
		ports, found, _ := unstructuredv1.NestedSlice(container, "ports")
		if !found {
			continue
		}
		for _, portValue := range ports {
			port, ok := portValue.(map[string]any)
			if !ok {
				continue
			}
			protocol, _, _ := unstructuredv1.NestedString(port, "protocol")
			if protocol == "" || strings.EqualFold(protocol, string(corev1.ProtocolTCP)) {
				return true
			}
		}
	}
	return false
}

func unstructuredServiceHasForwardablePorts(obj map[string]any) bool {
	ports, found, _ := unstructuredv1.NestedSlice(obj, "spec", "ports")
	if !found {
		return false
	}
	for _, portValue := range ports {
		port, ok := portValue.(map[string]any)
		if !ok {
			continue
		}
		protocol, _, _ := unstructuredv1.NestedString(port, "protocol")
		if protocol == "" || strings.EqualFold(protocol, string(corev1.ProtocolTCP)) {
			return true
		}
	}
	return false
}

func actionScaleTargetFromV1HPA(hpa *autoscalingv1.HorizontalPodAutoscaler) *ActionScaleTarget {
	if hpa == nil {
		return nil
	}
	return actionScaleTargetFromReference(hpa.Namespace, hpa.Spec.ScaleTargetRef.APIVersion, hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)
}

func actionScaleTargetFromV2HPA(hpa *autoscalingv2.HorizontalPodAutoscaler) *ActionScaleTarget {
	if hpa == nil {
		return nil
	}
	return actionScaleTargetFromReference(hpa.Namespace, hpa.Spec.ScaleTargetRef.APIVersion, hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)
}

func unstructuredHPAScaleTarget(item *unstructuredv1.Unstructured) *ActionScaleTarget {
	apiVersion, _, _ := unstructuredv1.NestedString(item.Object, "spec", "scaleTargetRef", "apiVersion")
	kind, _, _ := unstructuredv1.NestedString(item.Object, "spec", "scaleTargetRef", "kind")
	name, _, _ := unstructuredv1.NestedString(item.Object, "spec", "scaleTargetRef", "name")
	return actionScaleTargetFromReference(item.GetNamespace(), apiVersion, kind, name)
}

func actionScaleTargetFromReference(namespace, apiVersion, kind, name string) *ActionScaleTarget {
	if strings.TrimSpace(kind) == "" || strings.TrimSpace(name) == "" {
		return nil
	}
	gv, err := schema.ParseGroupVersion(strings.TrimSpace(apiVersion))
	if err != nil {
		return nil
	}
	return &ActionScaleTarget{
		Group:     gv.Group,
		Version:   gv.Version,
		Kind:      strings.TrimSpace(kind),
		Namespace: strings.TrimSpace(namespace),
		Name:      strings.TrimSpace(name),
	}
}
