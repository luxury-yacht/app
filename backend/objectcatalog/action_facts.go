package objectcatalog

import (
	"strings"

	cronjobpkg "github.com/luxury-yacht/app/backend/resources/cronjob"
	daemonsetpkg "github.com/luxury-yacht/app/backend/resources/daemonset"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	jobpkg "github.com/luxury-yacht/app/backend/resources/job"
	nodespkg "github.com/luxury-yacht/app/backend/resources/nodes"
	podspkg "github.com/luxury-yacht/app/backend/resources/pods"
	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
	statefulsetpkg "github.com/luxury-yacht/app/backend/resources/statefulset"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func buildSummaryActionFacts(desc Descriptor, item metav1.Object) *ActionFacts {
	if item == nil {
		return nil
	}
	switch obj := item.(type) {
	case *autoscalingv1.HorizontalPodAutoscaler:
		return &ActionFacts{ScaleTarget: actionScaleTargetFromV1HPA(obj)}
	case *autoscalingv2.HorizontalPodAutoscaler:
		return &ActionFacts{ScaleTarget: actionScaleTargetFromV2HPA(obj)}
	case *unstructuredv1.Unstructured:
		return buildUnstructuredSummaryActionFacts(desc, obj)
	default:
		// Typed built-in kinds reuse their object-map action-facts projection from
		// the single registry, so the per-kind projection lives once — in the kind
		// package — instead of being copied here. (HorizontalPodAutoscaler has no
		// object-map collector; its ScaleTarget is handled above.)
		return actionFactsFromObjectMap(objectMapActionFacts(desc, item))
	}
}

// objectMapActionFactsByKind indexes each kind's registry-declared object-map
// action-facts projection by GroupKind, so the catalog reuses it rather than
// re-deriving per-kind facts.
var objectMapActionFactsByKind = func() map[schema.GroupKind]func(metav1.Object) *objectmap.ActionFacts {
	m := make(map[schema.GroupKind]func(metav1.Object) *objectmap.ActionFacts)
	for _, d := range kindregistry.All {
		if d.Collector != nil && d.Collector.ActionFacts != nil {
			m[schema.GroupKind{Group: d.Identity.Group, Kind: d.Identity.Kind}] = d.Collector.ActionFacts
		}
	}
	return m
}()

// objectMapActionFacts runs the registry projection for desc's kind, or returns
// nil when the kind has none.
func objectMapActionFacts(desc Descriptor, item metav1.Object) *objectmap.ActionFacts {
	fn := objectMapActionFactsByKind[schema.GroupKind{Group: desc.Group, Kind: desc.Kind}]
	if fn == nil {
		return nil
	}
	return fn(item)
}

// actionFactsFromObjectMap copies the neutral object-map action facts into the
// catalog's summary action facts (which additionally carries the backend-only HPA
// ScaleTarget, set on the HPA branch of buildSummaryActionFacts).
func actionFactsFromObjectMap(f *objectmap.ActionFacts) *ActionFacts {
	if f == nil {
		return nil
	}
	return &ActionFacts{
		Status:               f.Status,
		Unschedulable:        f.Unschedulable,
		PortForwardAvailable: f.PortForwardAvailable,
		HPAManaged:           f.HPAManaged,
		DesiredReplicas:      f.DesiredReplicas,
	}
}

func buildUnstructuredSummaryActionFacts(desc Descriptor, item *unstructuredv1.Unstructured) *ActionFacts {
	if item == nil {
		return nil
	}
	if desc.Group == "autoscaling" && desc.Kind == hpapkg.Identity.Kind {
		if target := unstructuredHPAScaleTarget(item); target != nil {
			return &ActionFacts{ScaleTarget: target}
		}
		return nil
	}

	gvk := schema.GroupVersionKind{Group: desc.Group, Version: desc.Version, Kind: desc.Kind}
	switch gvk {
	case schema.GroupVersionKind{Group: podspkg.Identity.Group, Version: podspkg.Identity.Version, Kind: podspkg.Identity.Kind}:
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "containers")
		return &ActionFacts{PortForwardAvailable: &available}
	case schema.GroupVersionKind{Group: servicepkg.Identity.Group, Version: servicepkg.Identity.Version, Kind: servicepkg.Identity.Kind}:
		available := unstructuredHasForwardablePorts(item.Object, "spec", "ports")
		return &ActionFacts{PortForwardAvailable: &available}
	case schema.GroupVersionKind{Group: nodespkg.Identity.Group, Version: nodespkg.Identity.Version, Kind: nodespkg.Identity.Kind}:
		unschedulable, _, _ := unstructuredv1.NestedBool(item.Object, "spec", "unschedulable")
		return &ActionFacts{Unschedulable: &unschedulable}
	case schema.GroupVersionKind{Group: deploymentpkg.Identity.Group, Version: deploymentpkg.Identity.Version, Kind: deploymentpkg.Identity.Kind},
		schema.GroupVersionKind{Group: statefulsetpkg.Identity.Group, Version: statefulsetpkg.Identity.Version, Kind: statefulsetpkg.Identity.Kind},
		schema.GroupVersionKind{Group: replicasetpkg.Identity.Group, Version: replicasetpkg.Identity.Version, Kind: replicasetpkg.Identity.Kind}:
		return unstructuredScalableWorkloadFacts(item, "spec", "template", "spec", "containers")
	case schema.GroupVersionKind{Group: daemonsetpkg.Identity.Group, Version: daemonsetpkg.Identity.Version, Kind: daemonsetpkg.Identity.Kind},
		schema.GroupVersionKind{Group: jobpkg.Identity.Group, Version: jobpkg.Identity.Version, Kind: jobpkg.Identity.Kind}:
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "template", "spec", "containers")
		return &ActionFacts{PortForwardAvailable: &available}
	case schema.GroupVersionKind{Group: cronjobpkg.Identity.Group, Version: cronjobpkg.Identity.Version, Kind: cronjobpkg.Identity.Kind}:
		available := unstructuredHasForwardableContainerPorts(item.Object, "spec", "jobTemplate", "spec", "template", "spec", "containers")
		facts := &ActionFacts{PortForwardAvailable: &available}
		if suspended, found, _ := unstructuredv1.NestedBool(item.Object, "spec", "suspend"); found && suspended {
			facts.Status = "Suspended"
		}
		return facts
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
		if unstructuredHasForwardablePorts(container, "ports") {
			return true
		}
	}
	return false
}

func unstructuredHasForwardablePorts(obj map[string]any, fields ...string) bool {
	ports, found, _ := unstructuredv1.NestedSlice(obj, fields...)
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
