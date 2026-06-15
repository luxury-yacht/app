package resourcemodel

import (
	"fmt"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func BuildCustomResourceModel(
	clusterID string,
	resource *unstructured.Unstructured,
	gvr schema.GroupVersionResource,
	kindFallback string,
	crdName string,
	scope ResourceScope,
	namespaceFallback string,
	options ...ResourceModelBuildOptions,
) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildCustomResourceFacts(clusterID, resource, gvr, crdName, buildOptions)
	status := BuildCustomResourceStatusPresentation(resource, facts)
	meta := metav1.ObjectMeta{}
	if resource != nil {
		meta = objectMetaFromUnstructured(resource)
		if meta.Namespace == "" {
			meta.Namespace = namespaceFallback
		}
	}
	kind := resourceKind(resource, kindFallback)
	return NetworkResourceModel(clusterID, gvr.Group, gvr.Version, kind, gvr.Resource, scope, meta, status, ResourceFacts{CustomResource: &facts})
}

func BuildCustomResourceFacts(
	clusterID string,
	resource *unstructured.Unstructured,
	gvr schema.GroupVersionResource,
	crdName string,
	options ResourceModelBuildOptions,
) CustomResourceFacts {
	facts := CustomResourceFacts{}
	if crdName != "" {
		link := ClusterResourceLink(clusterID, apiextensionsAPIGroup, "v1", "CustomResourceDefinition", "customresourcedefinitions", crdName, "")
		facts.CRD = &link
	}
	if resource == nil {
		return facts
	}
	facts.Phase = nestedString(resource.Object, "status", "phase")
	facts.State = nestedString(resource.Object, "status", "state")
	facts.Ready = customResourceReady(resource.Object)
	facts.ObservedGeneration = nestedInt64Ptr(resource.Object, "status", "observedGeneration")
	facts.Conditions = customResourceConditions(resource.Object)
	if options.Materialization.Has(MaterializeDetailFacts) {
		if rawStatus, ok, _ := unstructured.NestedMap(resource.Object, "status"); ok {
			facts.RawStatus = rawStatus
		}
	}
	return facts
}

func BuildCustomResourceStatusPresentation(resource *unstructured.Unstructured, facts CustomResourceFacts) ResourceStatusPresentation {
	signals := make([]ResourceStatusSignal, 0, len(facts.Conditions)+3)
	if facts.Phase != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalPhase, Name: "status.phase", Status: facts.Phase})
	}
	if facts.State != "" {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalResourceState, Name: "status.state", Status: facts.State})
	}
	if facts.Ready != nil {
		signals = append(signals, ResourceStatusSignal{Type: StatusSignalReadiness, Name: "status.ready", Status: fmt.Sprintf("%t", *facts.Ready)})
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}

	state, label, presentation := customResourcePrimaryStatus(facts)
	meta := metav1.ObjectMeta{}
	if resource != nil {
		meta = objectMetaFromUnstructured(resource)
	}
	lifecycle := NetworkLifecycle(meta)
	if resource != nil {
		if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
			return status
		}
	}
	return NetworkSourceStatus(label, state, "", presentation, signals, lifecycle)
}

func customResourcePrimaryStatus(facts CustomResourceFacts) (state, label, presentation string) {
	if facts.Phase != "" {
		return facts.Phase, facts.Phase, customResourcePresentation(facts.Phase)
	}
	if facts.State != "" {
		return facts.State, facts.State, customResourcePresentation(facts.State)
	}
	if facts.Ready != nil {
		if *facts.Ready {
			return "true", "Ready", "ready"
		}
		return "false", "Not Ready", "warning"
	}
	if condition := conditionByType(facts.Conditions, "Ready"); condition != nil {
		return condition.Status, condition.Status, conditionPresentation(condition.Status)
	}
	return "unknown", "Unknown", "unknown"
}

func customResourceConditions(object map[string]any) []ConditionFacts {
	conditions, ok, _ := unstructured.NestedSlice(object, "status", "conditions")
	if !ok || len(conditions) == 0 {
		return nil
	}
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, raw := range conditions {
		condition, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		next := ConditionFacts{
			Type:    stringValue(condition["type"]),
			Status:  stringValue(condition["status"]),
			Reason:  stringValue(condition["reason"]),
			Message: stringValue(condition["message"]),
		}
		if timestamp := stringValue(condition["lastTransitionTime"]); timestamp != "" {
			if parsed, err := time.Parse(time.RFC3339, timestamp); err == nil {
				next.LastTransitionTime = metav1.NewTime(parsed)
			}
		}
		if next.Type == "" && next.Status == "" {
			continue
		}
		facts = append(facts, next)
	}
	return facts
}

func customResourceReady(object map[string]any) *bool {
	if ready, ok, _ := unstructured.NestedBool(object, "status", "ready"); ok {
		return &ready
	}
	if readyString := nestedString(object, "status", "ready"); readyString != "" {
		ready := strings.EqualFold(readyString, "true")
		return &ready
	}
	if condition := conditionByType(customResourceConditions(object), "Ready"); condition != nil {
		ready := strings.EqualFold(condition.Status, "true")
		return &ready
	}
	return nil
}

func conditionByType(conditions []ConditionFacts, conditionType string) *ConditionFacts {
	for i := range conditions {
		if strings.EqualFold(conditions[i].Type, conditionType) {
			return &conditions[i]
		}
	}
	return nil
}

func nestedString(object map[string]any, fields ...string) string {
	value, ok, _ := unstructured.NestedString(object, fields...)
	if !ok {
		return ""
	}
	return value
}

func nestedInt64Ptr(object map[string]any, fields ...string) *int64 {
	value, ok, _ := unstructured.NestedInt64(object, fields...)
	if !ok {
		return nil
	}
	return &value
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func customResourcePresentation(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "ready", "running", "active", "available", "bound", "succeeded", "true":
		return "ready"
	case "pending", "progressing", "reconciling", "creating", "updating":
		return "progressing"
	case "failed", "error", "false":
		return "error"
	default:
		return "unknown"
	}
}

func conditionPresentation(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "true":
		return "ready"
	case "false":
		return "warning"
	default:
		return "unknown"
	}
}

func resourceKind(resource *unstructured.Unstructured, fallback string) string {
	if resource == nil {
		return fallback
	}
	if kind := strings.TrimSpace(resource.GetKind()); kind != "" {
		return kind
	}
	return fallback
}

func objectMetaFromUnstructured(resource *unstructured.Unstructured) metav1.ObjectMeta {
	if resource == nil {
		return metav1.ObjectMeta{}
	}
	return metav1.ObjectMeta{
		Name:              resource.GetName(),
		Namespace:         resource.GetNamespace(),
		UID:               resource.GetUID(),
		ResourceVersion:   resource.GetResourceVersion(),
		Generation:        resource.GetGeneration(),
		Labels:            CopyStringMap(resource.GetLabels()),
		Annotations:       CopyStringMap(resource.GetAnnotations()),
		CreationTimestamp: resource.GetCreationTimestamp(),
		DeletionTimestamp: resource.GetDeletionTimestamp(),
		Finalizers:        append([]string(nil), resource.GetFinalizers()...),
	}
}
